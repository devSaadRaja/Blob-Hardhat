// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract USDC is ERC20 {
    string private _name = "USDC";
    string private constant _symbol = "USDC";
    uint private constant _numTokens = 10_000_000_000;

    constructor() ERC20(_name, _symbol) {
        _mint(msg.sender, _numTokens * 10 ** decimals());
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
