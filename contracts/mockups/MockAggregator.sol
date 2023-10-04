// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import {intoUint256, ud} from "@prb/math/src/UD60x18.sol";

contract MockAggregator {
    // only for test cases

    int256 price;

    constructor(int256 _price) {
        price = _price;
    }

    function setPrice(int256 _price) external {
        require(_price > 0);
        price = _price;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, price, 1, 1, 1);
    }
}
