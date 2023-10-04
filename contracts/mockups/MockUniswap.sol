// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IERC20Mod is IERC20 {
    function decimals() external returns (uint8);

    function getPrice() external returns (uint256);

    function calculateFeeAmount(address, address) external returns (uint256);
}

contract MockUniswapRouter {
    event Swap(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] path,
        address to,
        uint256 deadline
    );

    function _convertTo18Decimals(
        uint256 amount,
        uint8 decimals
    ) internal pure returns (uint256) {
        uint256 base = 10 ** 18;
        uint256 factor = base / (10 ** uint256(decimals));

        return amount * factor;
    }

    function _convertFrom18Decimals(
        uint256 amount,
        uint8 decimals
    ) internal pure returns (uint256) {
        uint256 base = 10 ** 18;
        uint256 factor = base / (10 ** uint256(decimals));

        return amount / factor;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) public returns (uint256[] memory amounts) {
        require(path.length >= 2, "Invalid path");
        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        uint8 decimalsIn = IERC20Mod(tokenIn).decimals();
        uint8 decimalsOut = IERC20Mod(tokenOut).decimals();

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        if (decimalsIn != 18) {
            amountIn = _convertTo18Decimals(amountIn, decimalsIn);
        }

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; i++) {
            // Mock price change, replace with your own logic
            amounts[i] = amounts[i - 1];
            if (decimalsOut != 18) {
                amounts[i] = _convertFrom18Decimals(amounts[i], decimalsOut);
            }
        }

        uint256 amountOut = amounts[amounts.length - 1];
        require(amountOut >= amountOutMin, "Insufficient output amount");

        IERC20(tokenOut).transfer(to, amountOut);

        emit Swap(amountIn, amountOutMin, path, to, deadline);
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external {
        swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline);
    }

    function getAmountsOut(
        uint amountIn,
        address[] calldata path
    ) external returns (uint[] memory amounts) {
        require(path.length >= 2, "Invalid path");

        uint256 base = 1e18;

        uint8 decimalsIn = IERC20Mod(path[0]).decimals();
        uint8 decimalsOut = IERC20Mod(path[path.length - 1]).decimals();
        uint256 decimal = base / 10 ** decimalsOut;

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; i++) {
            if (decimalsIn == 18 && decimalsOut != 18) {
                amounts[i] = amounts[i - 1] / decimal;
            } else if (decimalsIn != 18 && decimalsOut == 18) {
                amounts[i] = amounts[i - 1] * decimal;
            } else {
                amounts[i] = amounts[i - 1];
            }
        }
    }
}
