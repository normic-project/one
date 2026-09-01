// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IResolutionModule} from "../interfaces/IResolutionModule.sol";
import {TickMath} from "../libraries/TickMath.sol";

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function observe(uint32[] calldata secondsAgos)
        external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

/// @notice Resolves ETH/USDG conditions using the historical V3 TWAP ending at resolvesAt.
/// It has no owner, setter, spot-price path, manual fallback or dependency on paid APIs.
contract UniswapTwapResolver is IResolutionModule {
    using Strings for uint256;
    using Strings for address;

    uint256 public constant USDG_UNIT = 1_000_000;
    IERC20Metadata public immutable weth;
    IERC20Metadata public immutable usdg;
    IUniswapV3Pool public immutable pool;
    uint32 public immutable twapWindow;
    uint24 public immutable poolFee;

    error InvalidConfiguration();
    error InvalidTerms();
    error ObservationRangeUnavailable();

    constructor(IERC20Metadata weth_, IERC20Metadata usdg_, IUniswapV3Pool pool_, uint32 twapWindow_) {
        if (address(weth_).code.length == 0 || address(usdg_).code.length == 0 || address(pool_).code.length == 0 ||
            address(weth_) == address(usdg_) || twapWindow_ < 5 minutes || twapWindow_ > 24 hours ||
            weth_.decimals() != 18 || usdg_.decimals() != 6) revert InvalidConfiguration();
        address token0 = pool_.token0();
        address token1 = pool_.token1();
        if (!((token0 == address(weth_) && token1 == address(usdg_)) ||
            (token0 == address(usdg_) && token1 == address(weth_)))) revert InvalidConfiguration();
        uint24 fee = pool_.fee();
        if (fee == 0 || fee >= 1_000_000) revert InvalidConfiguration();
        weth = weth_;
        usdg = usdg_;
        pool = pool_;
        twapWindow = twapWindow_;
        poolFee = fee;
    }

    function describe(AutoTerms calldata t) external view returns (Metadata memory m) {
        _validateTermsForCreation(t);
        string memory threshold = (uint256(t.threshold) / USDG_UNIT).toString();
        bool above = t.condition == Condition.ABOVE_OR_EQUAL;
        m.question = string.concat("Will ETH/USDG be ", above ? "at or above " : "below ", threshold,
            " USDG at Unix ", uint256(t.resolvesAt).toString(), "?");
        m.yesOutcome = above ? "The historical ETH/USDG TWAP is at or above the threshold"
            : "The historical ETH/USDG TWAP is below the threshold";
        m.noOutcome = above ? "The historical ETH/USDG TWAP is below the threshold"
            : "The historical ETH/USDG TWAP is at or above the threshold";
        m.category = "Crypto";
        m.rules = string.concat("YES iff the ", uint256(twapWindow / 60).toString(),
            "-minute arithmetic-mean Uniswap V3 WETH/USDG tick over the immutable interval ending exactly at the resolution timestamp satisfies the stated condition. Spot price and the time resolve() is called are ignored. If the pool lacks the required historical observations, resolution remains pending.");
        m.primarySource = string.concat("https://robinhoodchain.blockscout.com/address/", address(pool).toHexString());
        m.secondarySource = "";
        m.metadataURI = "";
    }

    function outcome(AutoTerms calldata t) external view returns (Outcome) {
        _validateTermsShape(t);
        if (block.timestamp < t.resolvesAt) revert InvalidTerms();
        uint256 price = priceAt(t.resolvesAt);
        bool yes = t.condition == Condition.ABOVE_OR_EQUAL ? price >= t.threshold : price < t.threshold;
        return yes ? Outcome.YES : Outcome.NO;
    }

    /// @return price Six-decimal USDG units for exactly 1e18 WETH units.
    function priceAt(uint64 resolutionTimestamp) public view returns (uint256 price) {
        if (block.timestamp < resolutionTimestamp || resolutionTimestamp < twapWindow) revert ObservationRangeUnavailable();
        uint256 endAgo = block.timestamp - resolutionTimestamp;
        uint256 startAgo = endAgo + twapWindow;
        if (startAgo > type(uint32).max) revert ObservationRangeUnavailable();
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = uint32(startAgo);
        secondsAgos[1] = uint32(endAgo);
        (int56[] memory cumulatives,) = pool.observe(secondsAgos);
        if (cumulatives.length != 2) revert ObservationRangeUnavailable();
        int56 delta = cumulatives[1] - cumulatives[0];
        int56 window = int56(uint56(twapWindow));
        int24 arithmeticMeanTick = int24(delta / window);
        if (delta < 0 && delta % window != 0) arithmeticMeanTick--;
        price = _quoteAtTick(arithmeticMeanTick, 1 ether, address(weth), address(usdg));
        if (price == 0) revert ObservationRangeUnavailable();
    }

    function _validateTermsForCreation(AutoTerms calldata t) private view {
        _validateTermsShape(t);
        if (t.closesAt <= block.timestamp + 60 || t.resolvesAt > block.timestamp + 365 days) revert InvalidTerms();
    }

    function _validateTermsShape(AutoTerms calldata t) private pure {
        if (t.threshold == 0 || uint256(t.threshold) % USDG_UNIT != 0 || t.resolvesAt < t.closesAt)
            revert InvalidTerms();
    }

    function _quoteAtTick(int24 tick, uint128 baseAmount, address baseToken, address quoteToken)
        private pure returns (uint256 quoteAmount)
    {
        uint160 sqrtRatioX96 = TickMath.getSqrtRatioAtTick(tick);
        if (sqrtRatioX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtRatioX96) * sqrtRatioX96;
            quoteAmount = baseToken < quoteToken
                ? Math.mulDiv(ratioX192, baseAmount, 1 << 192)
                : Math.mulDiv(1 << 192, baseAmount, ratioX192);
        } else {
            uint256 ratioX128 = Math.mulDiv(sqrtRatioX96, sqrtRatioX96, 1 << 64);
            quoteAmount = baseToken < quoteToken
                ? Math.mulDiv(ratioX128, baseAmount, 1 << 128)
                : Math.mulDiv(1 << 128, baseAmount, ratioX128);
        }
    }
}
