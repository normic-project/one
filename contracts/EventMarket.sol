// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PredictionMarket} from "./PredictionMarket.sol";
import {IResolutionModule} from "./interfaces/IResolutionModule.sol";

contract EventMarket is PredictionMarket {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_EVIDENCE_BYTES = 512;
    address public immutable resolverMultisig;
    uint64 public immutable disputePeriod;
    uint256 public immutable proposalBond;

    address public proposer;
    IResolutionModule.Outcome public proposedOutcome;
    uint64 public disputeDeadline;
    string public proposalEvidence;
    address public disputer;
    IResolutionModule.Outcome public disputedOutcome;
    string public disputeEvidence;
    uint256 public bondEscrowed;

    error InvalidOutcome();
    error InvalidEvidence();
    error InvalidState();
    error DisputeWindowOpen();
    error DisputeWindowClosed();
    error SameParty();
    error UnsupportedToken();

    event OutcomeProposed(address indexed proposer, IResolutionModule.Outcome indexed outcome,
        bytes32 indexed evidenceHash, string evidence, uint64 disputeDeadline, uint256 bond);
    event OutcomeDisputed(address indexed disputer, IResolutionModule.Outcome indexed alternative,
        bytes32 indexed evidenceHash, string evidence, uint256 bond);
    event DisputeAdjudicated(address indexed resolver, IResolutionModule.Outcome indexed outcome);
    event BondsSettled(address indexed proposer, address indexed disputer, IResolutionModule.Outcome outcome,
        uint256 proposerPayout, uint256 disputerPayout);

    constructor(
        IERC20 token_,
        address settlement_,
        address resolverMultisig_,
        uint256 proposalBond_,
        uint64 disputePeriod_
    ) PredictionMarket(token_, settlement_) {
        if (resolverMultisig_ == address(0) || resolverMultisig_ == settlement_ ||
            proposalBond_ == 0 || disputePeriod_ == 0) revert InvalidMetadata();
        resolverMultisig = resolverMultisig_;
        proposalBond = proposalBond_;
        disputePeriod = disputePeriod_;
    }

    function initialize(
        address creator_,
        uint64 closesAt_,
        uint64 resolvesAt_,
        IResolutionModule.Metadata calldata metadata_
    ) external initializer nonReentrant {
        if (resolverMultisig == creator_) revert InvalidMetadata();
        _initializePredictionMarket(creator_, IResolutionModule.MarketType.EVENT_MARKET,
            closesAt_, resolvesAt_, metadata_);
    }

    function propose(IResolutionModule.Outcome outcome_, string calldata evidence) external nonReentrant {
        if (marketState() != IResolutionModule.MarketState.CLOSED || block.timestamp < resolvesAt) revert InvalidState();
        _validateOutcomeAndEvidence(outcome_, evidence);
        _takeBond(msg.sender);
        proposer = msg.sender;
        proposedOutcome = outcome_;
        proposalEvidence = evidence;
        bytes32 evidenceHash = keccak256(bytes(evidence));
        disputeDeadline = uint64(block.timestamp) + disputePeriod;
        _state = IResolutionModule.MarketState.PROPOSED;
        emit OutcomeProposed(msg.sender, outcome_, evidenceHash, evidence, disputeDeadline, proposalBond);
    }

    function dispute(IResolutionModule.Outcome alternative, string calldata evidence) external nonReentrant {
        if (_state != IResolutionModule.MarketState.PROPOSED) revert InvalidState();
        if (block.timestamp >= disputeDeadline) revert DisputeWindowClosed();
        if (msg.sender == proposer) revert SameParty();
        _validateOutcomeAndEvidence(alternative, evidence);
        if (alternative == proposedOutcome) revert InvalidOutcome();
        _takeBond(msg.sender);
        disputer = msg.sender;
        disputedOutcome = alternative;
        disputeEvidence = evidence;
        bytes32 evidenceHash = keccak256(bytes(evidence));
        _state = IResolutionModule.MarketState.DISPUTED;
        emit OutcomeDisputed(msg.sender, alternative, evidenceHash, evidence, proposalBond);
    }

    function proposalEvidenceHash() external view returns (bytes32) {
        return proposer == address(0) ? bytes32(0) : keccak256(bytes(proposalEvidence));
    }

    function disputeEvidenceHash() external view returns (bytes32) {
        return disputer == address(0) ? bytes32(0) : keccak256(bytes(disputeEvidence));
    }

    function finalize() external nonReentrant {
        if (_state != IResolutionModule.MarketState.PROPOSED) revert InvalidState();
        if (block.timestamp < disputeDeadline) revert DisputeWindowOpen();
        IResolutionModule.Outcome finalOutcome = proposedOutcome;
        _resolve(finalOutcome);
        bondEscrowed = 0;
        token.safeTransfer(proposer, proposalBond);
        emit BondsSettled(proposer, address(0), finalOutcome, proposalBond, 0);
    }

    function adjudicate(IResolutionModule.Outcome finalOutcome) external nonReentrant {
        if (msg.sender != resolverMultisig) revert Unauthorized();
        if (_state != IResolutionModule.MarketState.DISPUTED) revert InvalidState();
        if (finalOutcome == IResolutionModule.Outcome.NONE) revert InvalidOutcome();

        _resolve(finalOutcome);
        bondEscrowed = 0;
        uint256 proposerPayout;
        uint256 disputerPayout;
        if (finalOutcome == proposedOutcome) {
            proposerPayout = proposalBond * 2;
            token.safeTransfer(proposer, proposerPayout);
        } else if (finalOutcome == disputedOutcome) {
            disputerPayout = proposalBond * 2;
            token.safeTransfer(disputer, disputerPayout);
        } else {
            proposerPayout = proposalBond;
            disputerPayout = proposalBond;
            token.safeTransfer(proposer, proposerPayout);
            token.safeTransfer(disputer, disputerPayout);
        }
        emit DisputeAdjudicated(msg.sender, finalOutcome);
        emit BondsSettled(proposer, disputer, finalOutcome, proposerPayout, disputerPayout);
    }

    function _takeBond(address from) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        bondEscrowed += proposalBond;
        token.safeTransferFrom(from, address(this), proposalBond);
        if (token.balanceOf(address(this)) - beforeBalance != proposalBond) revert UnsupportedToken();
    }

    function _validateOutcomeAndEvidence(IResolutionModule.Outcome outcome_, string calldata evidence) private pure {
        if (outcome_ == IResolutionModule.Outcome.NONE) revert InvalidOutcome();
        uint256 length = bytes(evidence).length;
        if (length == 0 || length > MAX_EVIDENCE_BYTES) revert InvalidEvidence();
    }
}
