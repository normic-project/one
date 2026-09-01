// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PredictionMarket} from "./PredictionMarket.sol";
import {IMarketTypes} from "./interfaces/IMarketTypes.sol";

/// @notice General event market with one narrowly scoped resolution authority.
contract EventMarket is PredictionMarket {
    address public immutable resolverMultisig;

    constructor(IERC20 token_, address settlement_, address resolverMultisig_)
        PredictionMarket(token_, settlement_)
    {
        if (resolverMultisig_ == address(0) || resolverMultisig_ == settlement_) revert InvalidMetadata();
        resolverMultisig = resolverMultisig_;
    }

    function initialize(
        address creator_,
        uint64 closesAt_,
        uint64 resolvesAt_,
        IMarketTypes.Metadata calldata metadata_
    ) external initializer nonReentrant {
        if (resolverMultisig == creator_) revert InvalidMetadata();
        _initializePredictionMarket(creator_, closesAt_, resolvesAt_, metadata_);
    }

    function resolve(IMarketTypes.Outcome outcome_) external nonReentrant {
        if (msg.sender != resolverMultisig) revert Unauthorized();
        if (block.timestamp < resolvesAt) revert NotReady();
        _resolve(outcome_);
    }
}
