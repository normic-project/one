// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDG is ERC20 {
    constructor() ERC20("Global Dollar", "USDG") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    int24 public averageTick;
    bool public historyAvailable = true;
    bool public scheduled;
    int24 public tickBefore;
    int24 public tickAfter;
    uint64 public switchTimestamp;

    constructor(address token0_, address token1_, uint24 fee_, int24 averageTick_) {
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
        averageTick = averageTick_;
    }

    function setAverageTick(int24 tick) external { averageTick = tick; }
    function setHistoryAvailable(bool available) external { historyAvailable = available; }
    function setTickSchedule(int24 beforeTick, int24 afterTick, uint64 switchAt) external {
        tickBefore = beforeTick;
        tickAfter = afterTick;
        switchTimestamp = switchAt;
        scheduled = true;
    }

    function observe(uint32[] calldata secondsAgos)
        external view returns (int56[] memory cumulatives, uint160[] memory secondsPerLiquidity)
    {
        require(historyAvailable, "OLD");
        cumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidity = new uint160[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; ++i) {
            uint256 target = block.timestamp - secondsAgos[i];
            if (!scheduled) cumulatives[i] = int56(uint56(target)) * int56(averageTick);
            else if (target <= switchTimestamp) cumulatives[i] = int56(uint56(target)) * int56(tickBefore);
            else cumulatives[i] = int56(uint56(switchTimestamp)) * int56(tickBefore) +
                int56(uint56(target - switchTimestamp)) * int56(tickAfter);
        }
    }
}

/// @dev Only ever deployed to the in-memory EVM. Never part of the production deployment bundle.
contract MockVerifier {
    bytes public response;
    bool public fail;
    function setResponse(bytes calldata value) external { response = value; }
    function setFail(bool value) external { fail = value; }
    function verify(bytes calldata, bytes calldata) external view returns (bytes memory) {
        require(!fail, "Invalid signature");
        return response;
    }
}

contract RejectETH { receive() external payable { revert("No ETH"); } }

contract TaxToken is ERC20 {
    constructor() ERC20("Tax", "TAX") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            super._update(from, address(0), value / 100);
            value -= value / 100;
        }
        super._update(from, to, value);
    }
}
