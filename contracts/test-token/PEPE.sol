// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract PEPE is ERC20 {
    string private _name = "Pepe";
    string private constant _symbol = "PEPE";
    uint private constant _numTokens = 10_000_000_000;

    constructor() ERC20(_name, _symbol) {
        _mint(msg.sender, _numTokens * 10 ** decimals());
    }
}
