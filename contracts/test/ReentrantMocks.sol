// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ReentrantToken is ERC20 {
    address private _target;
    bytes private _payload;
    bool private _armed;
    bool public blocked;
    constructor() ERC20("Reentrant", "REENT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function arm(address target, bytes calldata payload) external { _target = target; _payload = payload; _armed = true; }
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (_armed) {
            _armed = false;
            // solhint-disable-next-line avoid-low-level-calls
            (bool success,) = _target.call(_payload);
            blocked = !success;
        }
    }
}

contract ReentrantTreasury {
    address private _target;
    bytes private _payload;
    bool public blocked;
    function arm(address target, bytes calldata payload) external { _target = target; _payload = payload; }
    receive() external payable {
        if (_target != address(0)) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success,) = _target.call{value: msg.value}(_payload);
            blocked = !success;
        }
    }
}
