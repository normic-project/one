// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFeeFactory {
    function isMarket(address market) external view returns (bool);
    function orderBook() external view returns (address);
}
interface IFeeMarket { function creator() external view returns (address); }

/// @notice Holds creator fees only; protocol fees are sent to the immutable treasury at settlement.
contract FeeVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    address public immutable treasury;
    IFeeFactory public immutable factory;
    mapping(address => uint256) public claimable;
    mapping(address => uint256) public earnedByMarket;
    uint256 public totalClaimable;
    uint256 public totalProtocolPaid;
    error Unauthorized();
    error NothingToClaim();
    error UnsupportedToken();
    event FeesAccrued(address indexed market, address indexed creator, uint256 protocolFee, uint256 creatorFee);
    event FeesClaimed(address indexed creator, uint256 amount);

    constructor(IERC20 token_, address treasury_) {
        token = token_;
        treasury = treasury_;
        factory = IFeeFactory(msg.sender);
    }

    function collect(address market, uint256 principal) external nonReentrant {
        if (msg.sender != factory.orderBook() || !factory.isMarket(market)) revert Unauthorized();
        // Compute here as well: a caller never supplies an arbitrary fee split.
        uint256 protocolFee = principal * 4 / 1000;
        uint256 creatorFee = principal * 6 / 1000;
        address creator = IFeeMarket(market).creator();
        claimable[creator] += creatorFee;
        earnedByMarket[market] += creatorFee;
        totalClaimable += creatorFee;
        totalProtocolPaid += protocolFee;
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), protocolFee + creatorFee);
        if (token.balanceOf(address(this)) - beforeBalance != protocolFee + creatorFee) revert UnsupportedToken();
        token.safeTransfer(treasury, protocolFee);
        emit FeesAccrued(market, creator, protocolFee, creatorFee);
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        token.safeTransfer(msg.sender, amount);
        emit FeesClaimed(msg.sender, amount);
    }
}
