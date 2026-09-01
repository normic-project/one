// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PredictionMarket} from "./PredictionMarket.sol";
import {IResolutionModule} from "./interfaces/IResolutionModule.sol";

contract AutoMarket is PredictionMarket {
    IResolutionModule public immutable autoResolver;
    IResolutionModule.Condition private _condition;
    uint128 private _threshold;

    constructor(IERC20 token_, address settlement_, IResolutionModule resolver_)
        PredictionMarket(token_, settlement_)
    {
        if (address(resolver_).code.length == 0) revert InvalidMetadata();
        autoResolver = resolver_;
    }

    function initialize(
        address creator_,
        IResolutionModule.AutoTerms calldata terms_
    ) external initializer nonReentrant {
        _initializePredictionMarket(creator_, IResolutionModule.MarketType.AUTO_MARKET,
            terms_.closesAt, terms_.resolvesAt, autoResolver.describe(terms_));
        _condition = terms_.condition;
        _threshold = terms_.threshold;
    }

    function autoTerms() public view returns (IResolutionModule.AutoTerms memory) {
        return IResolutionModule.AutoTerms(_threshold, closesAt, resolvesAt, _condition);
    }

    function resolve() external nonReentrant {
        if (resolved()) revert AlreadyResolved();
        if (block.timestamp < resolvesAt) revert NotReady();
        _resolve(autoResolver.outcome(autoTerms()));
    }
}
