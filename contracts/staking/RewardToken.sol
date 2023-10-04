// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";

/**
 * @title Reward Token Contract
 *
 * @dev This is an ERC20 token with some voting features.
 *
 * Also this is a non transferable token so that proper governance votes could
 * be assured. Only to/from staking transfers are allowed.
 *
 * One get this token after staking the main token i.e. blob and get this sBlob
 * as a reward.
 */
contract RewardToken is Ownable, ERC20, ERC20Permit, ERC20Votes {
    address public staking;

    string private _name = "Reward Token";
    string private constant _symbol = "sBlob";
    uint private constant _numTokens = 10_000_000_000;

    /**
     * @dev Sets the values for {name} and {symbol}.
     *
     * All two of these values are immutable: they can only be set once during
     * construction.
     */
    constructor() ERC20(_name, _symbol) ERC20Permit(_name) {}

    /**
     * @dev Setting the staking address and minting sBlob as much as there
     * are blob.
     */
    function initialize(address _staking) external onlyOwner {
        staking = _staking;
        _mint(_staking, _numTokens * 10 ** decimals());
    }

    /**
     * @dev Overrides _tranfer to limit it to/from staking.
     */
    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        require(from == staking || to == staking, "Can't transfer sBlob");
        super._transfer(from, to, amount);
    }

    /**
     * @dev Overrides _afterTokenTransfer.
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20, ERC20Votes) {
        super._afterTokenTransfer(from, to, amount);
    }

    /**
     * @dev Overrides _mint.
     */
    function _mint(
        address to,
        uint256 amount
    ) internal override(ERC20, ERC20Votes) {
        super._mint(to, amount);
    }

    /**
     * @dev Overrides _burn.
     */
    function _burn(
        address account,
        uint256 amount
    ) internal override(ERC20, ERC20Votes) {
        super._burn(account, amount);
    }
}
