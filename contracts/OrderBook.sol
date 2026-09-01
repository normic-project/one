// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PredictionMarket} from "./PredictionMarket.sol";
import {FeeVault} from "./FeeVault.sol";
import {TradeMath} from "./libraries/TradeMath.sol";

interface IMarketRegistry { function isMarket(address market) external view returns (bool); }

/// @notice Permissionless exact-price matching with prepaid buyer principal AND fees.
/// No signatures, operators, discretionary pricing, margin, or unbacked shares.
contract OrderBook is ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Order {
        address market;
        address owner;
        uint64 expiresAt;
        uint8 price;
        bool yes;
        bool buy;
        uint256 remaining;
    }
    struct OrderRequest {
        address market;
        uint64 expiresAt;
        uint8 price;
        bool yes;
        bool buy;
        uint256 shares;
    }
    IERC20 public immutable token;
    FeeVault public immutable feeVault;
    IMarketRegistry public immutable factory;
    uint256 public nextOrderId = 1;
    uint256 public escrowedUSDG;
    mapping(uint256 => Order) public orders;
    mapping(address => uint256[]) private _marketOrders;
    mapping(address => uint256[]) private _userOrders;
    error InvalidMarket();
    error InvalidExpiry();
    error TradingClosed();
    error InactiveOrder();
    error Unauthorized();
    error IncompatibleOrders();
    error InvalidFill();
    error TooManyMatches();
    error UnsupportedToken();
    event OrderPlaced(uint256 indexed id, address indexed market, address indexed owner, bool yes, bool buy,
        uint8 price, uint256 shares, uint64 expiresAt);
    event OrderCancelled(uint256 indexed id, address indexed owner, uint256 refundedShares);
    event OrdersMatched(uint256 indexed firstId, uint256 indexed secondId, address indexed market,
        uint256 shares, uint8 yesPrice, uint256 notional, bool mint, uint256 timestamp);

    constructor(IERC20 token_, FeeVault feeVault_) {
        token = token_;
        feeVault = feeVault_;
        factory = IMarketRegistry(msg.sender);
    }

    function placeOrder(OrderRequest calldata request) external nonReentrant returns (uint256) {
        return _place(request);
    }

    /// @notice Atomically attempt known compatible orders; stale/cancelled orders are skipped.
    /// User's exact limit remains binding. Any remainder stays open and cancellable.
    function placeAndMatch(OrderRequest calldata request, uint256[] calldata candidates)
        external nonReentrant returns (uint256 id)
    {
        if (candidates.length > 20) revert TooManyMatches();
        id = _place(request);
        for (uint256 i; i < candidates.length && orders[id].remaining != 0; ++i) {
            uint256 otherId = candidates[i];
            Order storage other = orders[otherId];
            if (otherId == id || !_compatible(orders[id], other) || !_active(other)) continue;
            uint256 amount = orders[id].remaining < other.remaining ? orders[id].remaining : other.remaining;
            _match(id, otherId, amount);
        }
    }

    function _place(OrderRequest calldata r) private returns (uint256 id) {
        if (!factory.isMarket(r.market)) revert InvalidMarket();
        PredictionMarket market = PredictionMarket(r.market);
        if (!market.isTrading()) revert TradingClosed();
        if (r.expiresAt <= block.timestamp || r.expiresAt > market.closesAt()) revert InvalidExpiry();
        TradeMath.validate(r.shares, r.price);
        id = nextOrderId++;
        orders[id] = Order(r.market, msg.sender, r.expiresAt, r.price, r.yes, r.buy, r.shares);
        _marketOrders[r.market].push(id);
        _userOrders[msg.sender].push(id);
        if (r.buy) {
            (uint256 principal, uint256 protocolFee, uint256 creatorFee) = TradeMath.quote(r.shares, r.price);
            uint256 payment = principal + protocolFee + creatorFee;
            escrowedUSDG += payment;
            uint256 beforeBalance = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), payment);
            if (token.balanceOf(address(this)) - beforeBalance != payment) revert UnsupportedToken();
        } else {
            market.escrowShares(msg.sender, r.yes, r.shares);
        }
        emit OrderPlaced(id, r.market, msg.sender, r.yes, r.buy, r.price, r.shares, r.expiresAt);
    }

    function cancelOrder(uint256 id) external nonReentrant {
        Order storage order = orders[id];
        uint256 amount = order.remaining;
        if (amount == 0) revert InactiveOrder();
        // Anyone may clean up expired/closed orders, but refunds always go to the owner.
        if (msg.sender != order.owner && block.timestamp < order.expiresAt &&
            PredictionMarket(order.market).isTrading()) revert Unauthorized();
        order.remaining = 0;
        if (order.buy) {
            (uint256 principal, uint256 protocolFee, uint256 creatorFee) = TradeMath.quote(amount, order.price);
            uint256 refund = principal + protocolFee + creatorFee;
            escrowedUSDG -= refund;
            token.safeTransfer(order.owner, refund);
        } else {
            PredictionMarket(order.market).releaseShares(order.owner, order.yes, amount);
        }
        emit OrderCancelled(id, order.owner, amount);
    }

    function matchOrders(uint256 firstId, uint256 secondId, uint256 amount) external nonReentrant {
        _match(firstId, secondId, amount);
    }

    function _match(uint256 firstId, uint256 secondId, uint256 amount) private {
        Order storage a = orders[firstId];
        Order storage b = orders[secondId];
        if (firstId == secondId || !_compatible(a, b)) revert IncompatibleOrders();
        if (!_active(a) || !_active(b)) revert InactiveOrder();
        if (!PredictionMarket(a.market).isTrading()) revert TradingClosed();
        if (amount == 0 || amount > a.remaining || amount > b.remaining) revert InvalidFill();
        a.remaining -= amount;
        b.remaining -= amount;
        PredictionMarket market = PredictionMarket(a.market);
        uint256 principal;
        uint8 yesPrice;
        bool mint = a.buy && b.buy;
        if (mint) {
            principal = amount * TradeMath.UNIT;
            yesPrice = a.yes ? a.price : b.price;
            _debit(principal);
            token.forceApprove(address(market.collateralVault()), principal);
            market.mintPair(a.yes ? a.owner : b.owner, a.yes ? b.owner : a.owner, amount);
        } else {
            Order storage buyer = a.buy ? a : b;
            Order storage seller = a.buy ? b : a;
            (principal,,) = TradeMath.quote(amount, buyer.price);
            yesPrice = buyer.yes ? buyer.price : 100 - buyer.price;
            _debit(principal);
            market.releaseShares(buyer.owner, buyer.yes, amount);
            token.safeTransfer(seller.owner, principal);
        }
        token.forceApprove(address(feeVault), principal / 100);
        feeVault.collect(a.market, principal);
        market.recordTrade(principal, yesPrice);
        emit OrdersMatched(firstId, secondId, a.market, amount, yesPrice, principal, mint, block.timestamp);
    }

    function _debit(uint256 principal) private { escrowedUSDG -= principal + principal / 100; }
    function _active(Order storage order) private view returns (bool) {
        return order.remaining != 0 && block.timestamp < order.expiresAt;
    }
    function _compatible(Order storage a, Order storage b) private view returns (bool) {
        if (a.market != b.market || a.owner == b.owner || b.owner == address(0)) return false;
        if (a.buy && b.buy) return a.yes != b.yes && uint256(a.price) + b.price == 100;
        return a.buy != b.buy && a.yes == b.yes && a.price == b.price;
    }

    function marketOrderCount(address market) external view returns (uint256) { return _marketOrders[market].length; }
    function userOrderCount(address user) external view returns (uint256) { return _userOrders[user].length; }
    function marketOrderIds(address market, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        return _page(_marketOrders[market], offset, limit);
    }
    function userOrderIds(address user, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        return _page(_userOrders[user], offset, limit);
    }
    function _page(uint256[] storage ids, uint256 offset, uint256 limit) private view returns (uint256[] memory page) {
        if (limit > 100) limit = 100;
        uint256 size = offset >= ids.length ? 0 : (ids.length - offset < limit ? ids.length - offset : limit);
        page = new uint256[](size);
        for (uint256 i; i < size; ++i) page[i] = ids[offset + i];
    }
}
