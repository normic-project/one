// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CollateralVault} from "./CollateralVault.sol";
import {IResolutionModule} from "./interfaces/IResolutionModule.sol";

/// @notice The trading, collateral and redemption engine shared by every market type.
/// Shares are deliberately nontransferable outside the protocol order book.
abstract contract PredictionMarket is ReentrancyGuard {
    struct MetadataHashes {
        bytes32 question;
        bytes32 yesOutcome;
        bytes32 noOutcome;
        bytes32 rules;
        bytes32 primarySource;
        bytes32 secondarySource;
        bytes32 resolutionTimestamp;
    }

    uint256 public constant USDG_UNIT = 1_000_000;
    uint256 public constant INVALID_PAYOUT = 500_000;
    uint256 public constant MAX_QUESTION_BYTES = 280;
    uint256 public constant MAX_OUTCOME_BYTES = 280;
    uint256 public constant MAX_CATEGORY_BYTES = 32;
    uint256 public constant MAX_RULES_BYTES = 2_048;
    uint256 public constant MAX_SOURCE_BYTES = 512;
    uint256 public constant MAX_URI_BYTES = 512;

    IERC20 public immutable token;
    address public creator;
    IResolutionModule.MarketType public marketType;
    uint64 public closesAt;
    address public immutable settlement;
    uint64 public resolvesAt;
    CollateralVault public collateralVault;

    IResolutionModule.Metadata private _metadata;
    IResolutionModule.MarketState internal _state;
    IResolutionModule.Outcome public resolvedOutcome;

    bytes32 public metadataHash;

    mapping(address => mapping(bool => uint256)) public sharesOf;
    mapping(bool => uint256) public totalShares;
    uint256 public volume;
    bool public hasTraded;
    uint8 public lastYesPrice;
    bool private _initialized;

    error Unauthorized();
    error TradingClosed();
    error NotReady();
    error AlreadyResolved();
    error InvalidAmount();
    error InvalidMetadata();
    error InvalidTimeline();
    error AlreadyInitialized();

    event MetadataCommitted(
        bytes32 indexed metadataHash,
        bytes32 indexed questionHash,
        bytes32 indexed resolutionRulesHash,
        bytes32 yesOutcomeHash,
        bytes32 noOutcomeHash,
        bytes32 primarySourceHash,
        bytes32 secondarySourceHash,
        bytes32 resolutionTimestampHash
    );
    event Resolved(IResolutionModule.Outcome indexed outcome);
    event Redeemed(address indexed account, bool indexed yes, uint256 shares, uint256 payout);

    constructor(IERC20 token_, address settlement_) {
        if (address(token_).code.length == 0 || settlement_ == address(0)) revert InvalidMetadata();
        token = token_;
        settlement = settlement_;
        _initialized = true;
    }

    modifier initializer() {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        _;
    }

    function _initializePredictionMarket(
        address creator_,
        IResolutionModule.MarketType marketType_,
        uint64 closesAt_,
        uint64 resolvesAt_,
        IResolutionModule.Metadata memory metadata_
    ) internal {
        if (creator_ == address(0)) revert InvalidMetadata();
        if (closesAt_ <= block.timestamp + 60 || resolvesAt_ < closesAt_ || resolvesAt_ > block.timestamp + 365 days)
            revert InvalidTimeline();
        _validateMetadata(metadata_);

        creator = creator_;
        marketType = marketType_;
        closesAt = closesAt_;
        resolvesAt = resolvesAt_;
        _metadata = metadata_;
        collateralVault = new CollateralVault(token);

        (MetadataHashes memory hashes, bytes32 commitment) =
            _metadataCommitment(metadata_, closesAt_, resolvesAt_, marketType_);
        metadataHash = commitment;
        emit MetadataCommitted(commitment, hashes.question, hashes.rules, hashes.yesOutcome, hashes.noOutcome,
            hashes.primarySource, hashes.secondarySource, hashes.resolutionTimestamp);
    }

    modifier onlySettlement() {
        if (msg.sender != settlement) revert Unauthorized();
        _;
    }

    function metadata() external view returns (IResolutionModule.Metadata memory) { return _metadata; }
    function questionHash() external view returns (bytes32) { return keccak256(bytes(_metadata.question)); }
    function yesOutcomeHash() external view returns (bytes32) { return keccak256(bytes(_metadata.yesOutcome)); }
    function noOutcomeHash() external view returns (bytes32) { return keccak256(bytes(_metadata.noOutcome)); }
    function resolutionRulesHash() external view returns (bytes32) { return keccak256(bytes(_metadata.rules)); }
    function primarySourceHash() external view returns (bytes32) { return keccak256(bytes(_metadata.primarySource)); }
    function secondarySourceHash() external view returns (bytes32) { return keccak256(bytes(_metadata.secondarySource)); }
    function resolutionTimestampHash() external view returns (bytes32) { return keccak256(abi.encode(resolvesAt)); }
    function resolved() public view returns (bool) { return resolvedOutcome != IResolutionModule.Outcome.NONE; }
    function yesWins() external view returns (bool) { return resolvedOutcome == IResolutionModule.Outcome.YES; }
    function isTrading() public view returns (bool) {
        return _state == IResolutionModule.MarketState.OPEN && !resolved() && block.timestamp < closesAt;
    }
    function marketState() public view returns (IResolutionModule.MarketState) {
        if (_state == IResolutionModule.MarketState.OPEN && block.timestamp >= closesAt)
            return IResolutionModule.MarketState.CLOSED;
        return _state;
    }

    function mintPair(address yesBuyer, address noBuyer, uint256 amount) external onlySettlement nonReentrant {
        if (!isTrading()) revert TradingClosed();
        if (amount == 0) revert InvalidAmount();
        sharesOf[yesBuyer][true] += amount;
        sharesOf[noBuyer][false] += amount;
        totalShares[true] += amount;
        totalShares[false] += amount;
        hasTraded = true;
        collateralVault.lockFrom(settlement, amount * USDG_UNIT);
    }

    function escrowShares(address account, bool yes, uint256 amount) external onlySettlement {
        if (!isTrading()) revert TradingClosed();
        sharesOf[account][yes] -= amount;
        sharesOf[settlement][yes] += amount;
    }

    /// @dev Returning escrowed shares remains possible after close and resolution.
    function releaseShares(address account, bool yes, uint256 amount) external onlySettlement {
        sharesOf[settlement][yes] -= amount;
        sharesOf[account][yes] += amount;
    }

    function recordTrade(uint256 notional, uint8 yesPrice) external onlySettlement {
        hasTraded = true;
        volume += notional;
        lastYesPrice = yesPrice;
    }

    function redeem(bool yes, uint256 amount) external nonReentrant {
        IResolutionModule.Outcome finalOutcome = resolvedOutcome;
        if (finalOutcome == IResolutionModule.Outcome.NONE) revert NotReady();
        if (amount == 0) revert InvalidAmount();
        sharesOf[msg.sender][yes] -= amount;
        totalShares[yes] -= amount;
        uint256 payout;
        if (finalOutcome == IResolutionModule.Outcome.INVALID) payout = amount * INVALID_PAYOUT;
        else if ((yes && finalOutcome == IResolutionModule.Outcome.YES) || (!yes && finalOutcome == IResolutionModule.Outcome.NO))
            payout = amount * USDG_UNIT;
        if (payout != 0) collateralVault.release(msg.sender, payout);
        emit Redeemed(msg.sender, yes, amount, payout);
    }

    function _resolve(IResolutionModule.Outcome outcome_) internal {
        if (resolved()) revert AlreadyResolved();
        if (outcome_ == IResolutionModule.Outcome.NONE) revert InvalidAmount();
        resolvedOutcome = outcome_;
        if (outcome_ == IResolutionModule.Outcome.YES) _state = IResolutionModule.MarketState.RESOLVED_YES;
        else if (outcome_ == IResolutionModule.Outcome.NO) _state = IResolutionModule.MarketState.RESOLVED_NO;
        else _state = IResolutionModule.MarketState.RESOLVED_INVALID;
        emit Resolved(outcome_);
    }

    function _metadataCommitment(
        IResolutionModule.Metadata memory metadata_,
        uint64 closesAt_,
        uint64 resolvesAt_,
        IResolutionModule.MarketType marketType_
    ) private pure returns (MetadataHashes memory hashes, bytes32 commitment) {
        hashes.question = keccak256(bytes(metadata_.question));
        hashes.yesOutcome = keccak256(bytes(metadata_.yesOutcome));
        hashes.noOutcome = keccak256(bytes(metadata_.noOutcome));
        hashes.rules = keccak256(bytes(metadata_.rules));
        hashes.primarySource = keccak256(bytes(metadata_.primarySource));
        hashes.secondarySource = keccak256(bytes(metadata_.secondarySource));
        hashes.resolutionTimestamp = keccak256(abi.encode(resolvesAt_));
        commitment = keccak256(abi.encode(
            hashes.question,
            hashes.yesOutcome,
            hashes.noOutcome,
            keccak256(bytes(metadata_.category)),
            hashes.rules,
            hashes.primarySource,
            hashes.secondarySource,
            keccak256(bytes(metadata_.metadataURI)),
            closesAt_,
            resolvesAt_,
            marketType_
        ));
    }

    function _validateMetadata(IResolutionModule.Metadata memory m) private pure {
        uint256 questionLength = bytes(m.question).length;
        uint256 yesLength = bytes(m.yesOutcome).length;
        uint256 noLength = bytes(m.noOutcome).length;
        uint256 categoryLength = bytes(m.category).length;
        uint256 rulesLength = bytes(m.rules).length;
        uint256 sourceLength = bytes(m.primarySource).length;
        if (questionLength == 0 || questionLength > MAX_QUESTION_BYTES || yesLength == 0 || yesLength > MAX_OUTCOME_BYTES ||
            noLength == 0 || noLength > MAX_OUTCOME_BYTES || categoryLength == 0 || categoryLength > MAX_CATEGORY_BYTES ||
            rulesLength == 0 || rulesLength > MAX_RULES_BYTES || sourceLength == 0 || sourceLength > MAX_SOURCE_BYTES ||
            bytes(m.secondarySource).length > MAX_SOURCE_BYTES || bytes(m.metadataURI).length > MAX_URI_BYTES)
            revert InvalidMetadata();
    }
}
