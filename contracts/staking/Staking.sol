// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

import {intoUint256, ud} from "@prb/math/src/UD60x18.sol";

interface IDateTime {
    function getDay(uint) external pure returns (uint8);
}

/**
 * @title Staking Contract
 * @dev This contract manages staking and rewards distribution for users.
 */
contract Staking is Ownable, ReentrancyGuard {
    // ==================== STRUCTURE ==================== //

    struct Epoch {
        uint256 staked; // totalStaked per epoch
        uint256 duration; // in seconds
        uint256 end; // timestamp
        uint256 distribute; // reward for this epoch
        uint256 rewardToStakedRatio; // (distribute / staked) + previous rewardToStakedRatio
    }

    struct StakeData {
        uint256 epochNumber; // first stake
        uint256 balance; // staked amount
        uint256 start; // starting time
        uint256 expiry; // warmup ending time
        uint256 lastClaimedEpoch; // max epoch that user has claimed (to reduce iterations)
    }

    uint256 public currentEpoch = 1;
    mapping(uint256 => Epoch) public epochs;

    uint256 public pageSize = 5;
    uint256 public amountPerEpoch;
    uint256 public totalRewardsLeft;
    uint256 public latestTreasuryReward;

    uint256 public totalStaked;
    uint256 public totalRewardsPaid;
    uint256 public warmupPeriod = 4 days;
    uint256 public epochDuration = 4 hours; // must be less than warmup

    address public datetime = 0x1a6184CD4C5Bea62B0116de7962EE7315B7bcBce; // mainnet address
    address public routerAddress = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D; // mainnet address

    address public USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48; // mainnet address
    address public swapper = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48; // USDC

    address public immutable BLOB;
    address public immutable SBLOB;

    mapping(address => StakeData[]) public stakes;
    mapping(address => uint256) public totalStakesByUser;
    mapping(address => uint256) public rewardsPaidToUser;

    address[] public reinvestSubsList;
    mapping(address => bool) public isSubscribed;
    mapping(address => uint256) public subsUserIndex;
    uint256 public autoReinvestThreshold; // USDC

    // ==================== EVENTS ==================== //

    event WarmupSet(uint256 warmup);
    event DurationSet(uint256 time);
    event RewardSwapped(uint256 blobAmount);
    event UpdateEpochReward(uint256 amount);
    event StartNextEpoch(uint256 epochNumber);
    event Stake(address indexed user, uint256 amount);
    event Unstake(address indexed user, uint256 amount);
    event Reinvest(address indexed user, uint256 amount);
    event ClaimRewards(address indexed user, uint256 amount);

    // ==================== MODIFIERS ==================== //

    modifier moreThanZero(uint256 value) {
        require(value > 0, "Value must be greater than 0");
        _;
    }

    modifier warmupPeriodEnded(address account, uint256 index) {
        require(
            stakes[account][index].expiry <= block.timestamp,
            "Warmup Period not Ended!"
        );
        _;
    }

    modifier isBalanceAvailable(
        address account,
        uint256 index,
        uint256 amount
    ) {
        require(stakes[account][index].balance >= amount, "Invalid amount");
        _;
    }

    modifier isValidAddress(address _address) {
        require(_address != address(0), "Invalid address");
        _;
    }

    // ==================== CONSTRUCTOR ==================== //

    constructor(address _BLOB, address _SBLOB) {
        BLOB = _BLOB;
        SBLOB = _SBLOB;
    }

    // ==================== FUNCTIONS ==================== //

    /**
     * @dev Gets the list of addresses subscribed to auto-reinvest feature.
     * @return An array containing subscribed addresses.
     */
    function getReinvestSubsList() external view returns (address[] memory) {
        return reinvestSubsList;
    }

    /**
     * @dev Gets the details of a specific epoch.
     * @param _epochNumber The epoch number.
     * @return The epoch details.
     */
    function getEpochDetails(
        uint256 _epochNumber
    ) external view returns (Epoch memory) {
        return epochs[_epochNumber];
    }

    /**
     * @dev Gets the staking details for a specific user.
     * @param account The user's address.
     * @return An array of stake data.
     */
    function getStakeDetails(
        address account
    ) external view returns (StakeData[] memory) {
        return stakes[account];
    }

    /**
     * @dev Sets the auto-reinvest threshold for users.
     * @param _amount The threshold amount.
     */
    function setAutoReinvestThreshold(
        uint256 _amount
    ) external moreThanZero(_amount) {
        autoReinvestThreshold = _amount;
    }

    /**
     * @dev Sets the warmup period duration.
     * @param _warmupPeriod The warmup period duration.
     *
     * Requirements:
     *
     * - `warmupPeriod` must be greater than epochDuration.
     */
    function setWarmupPeriod(
        uint256 _warmupPeriod
    ) external onlyOwner moreThanZero(_warmupPeriod) {
        require(_warmupPeriod > epochDuration);
        warmupPeriod = _warmupPeriod;

        emit WarmupSet(_warmupPeriod);
    }

    /**
     * @dev Sets the epoch duration.
     * @param _duration The epoch duration.
     *
     * Requirements:
     *
     * - `epochDuration` must be less than warmupPeriod.
     */
    function setEpochDuration(
        uint256 _duration
    ) external onlyOwner moreThanZero(_duration) {
        require(warmupPeriod > _duration);
        epochDuration = _duration;

        emit DurationSet(_duration);
    }

    /**
     * @dev Sets the address of the DateTime contract.
     * @param _datetime The address of the DateTime contract.
     */
    function setDatetime(
        address _datetime
    ) external onlyOwner isValidAddress(_datetime) {
        datetime = _datetime;
    }

    /**
     * @dev Sets the address of the Uniswap router.
     * @param _routerAddress The address of the Uniswap router.
     */
    function setRouter(
        address _routerAddress
    ) external onlyOwner isValidAddress(_routerAddress) {
        routerAddress = _routerAddress;
    }

    /**
     * @dev Sets the page size for reinvest eligibility calculations.
     * @param _pageSize The page size.
     */
    function setPageSize(
        uint256 _pageSize
    ) external onlyOwner moreThanZero(_pageSize) {
        pageSize = _pageSize;
    }

    /**
     * @dev Sets the swapper address for token swapping.
     * @param _swapperToken The address of the swapper token.
     */
    function setSwapper(address _swapperToken) external onlyOwner {
        require(_swapperToken != address(0), "Invalid address!");
        swapper = _swapperToken;
    }

    /**
     * @dev Sets the reward address for rewards distribution.
     * @param _rewardAddress The address of the reward token.
     */
    function setRewardAddress(address _rewardAddress) external onlyOwner {
        require(_rewardAddress != address(0), "Invalid address");
        USDC = _rewardAddress;
    }

    /**
     * @dev Deposits funds into the contract as a treasury reward.
     * @param _amount The amount to deposit.
     */
    function deposit(uint256 _amount) external {
        require(IERC20(USDC).balanceOf(msg.sender) >= _amount);

        IERC20(USDC).transferFrom(msg.sender, address(this), _amount);
        latestTreasuryReward += _amount;
    }

    /**
     * @dev Initializes the epoch rewards and starts the first epoch.
     */
    function initialize() external onlyOwner {
        _setEpochRewards();
        _initializeEpoch();
    }

    /**
     * @dev Subscribes a user to the auto-reinvest feature.
     */
    function subscribeAutoReinvest() external isValidAddress(msg.sender) {
        address _user = msg.sender;
        require(!isSubscribed[_user], "Already subscribed");

        subsUserIndex[_user] = reinvestSubsList.length;
        reinvestSubsList.push(_user);
        isSubscribed[_user] = true;
    }

    /**
     * @dev Unsubscribes a user from the auto-reinvest feature.
     */
    function unsubscribeAutoReinvest() external isValidAddress(msg.sender) {
        address _user = msg.sender;
        require(isSubscribed[_user], "Not subscribed");

        uint256 currIndex = subsUserIndex[_user];
        uint256 lastIndex = reinvestSubsList.length - 1;

        subsUserIndex[reinvestSubsList[lastIndex]] = currIndex;

        reinvestSubsList[currIndex] = reinvestSubsList[lastIndex];
        reinvestSubsList.pop();

        isSubscribed[_user] = false;
    }

    /**
     * @dev Stakes a specified amount of tokens.
     * @param amount The amount to stake.
     */
    function stake(uint256 amount) external moreThanZero(amount) {
        address account = msg.sender;

        bool success = IERC20(BLOB).transferFrom(
            account,
            address(this),
            amount
        );
        require(success, "Transfer Failed");

        _addStake(account, amount);

        emit Stake(account, amount);
    }

    /**
     * @dev Unstakes a specified amount of tokens.
     * @param amount The amount to unstake.
     */
    function unstake(uint256 amount) external moreThanZero(amount) {
        address account = msg.sender;
        require(amount <= totalStakesByUser[account], "Invalid amount");

        // claim before unstake
        if (amount == totalStakesByUser[account]) {
            uint256 claimAmount = getClaimable(account);
            if (claimAmount > 0) _claimAll(account, claimAmount);
            unstakeAll();
        } else {
            uint256 count;
            uint256[] memory toRemove = new uint256[](stakes[account].length);

            uint256 rewardAmount;
            uint256 amountLeft = amount;

            for (uint256 i = 0; i < stakes[account].length; i++) {
                StakeData storage info = stakes[account][i];

                if (amountLeft > 0 && info.expiry <= block.timestamp) {
                    uint256 calculation = calculateReward(account, i);
                    rewardAmount += calculation;

                    if (calculation > 0) info.lastClaimedEpoch = currentEpoch;

                    if (info.balance >= amountLeft) {
                        info.balance -= amountLeft;
                        amountLeft = 0;

                        if (info.balance == 0) {
                            toRemove[count] = i;
                            count++;
                        }
                    } else {
                        amountLeft -= info.balance;
                        toRemove[count] = i;
                        count++;
                    }
                }
            }

            for (uint i = 0; i < count; i++) _removeStake(account, toRemove[i]);

            if (rewardAmount > 0) _claimReward(account, rewardAmount);
            _unstake(account, amount);
        }
    }

    /**
     * @dev Unstakes a specified amount of tokens from a specific stake position.
     * @param amount The amount to unstake.
     * @param index The index of the stake position.
     */
    function unstake(
        uint256 amount,
        uint256 index
    )
        external
        moreThanZero(amount)
        warmupPeriodEnded(msg.sender, index)
        isBalanceAvailable(msg.sender, index, amount)
    {
        address account = msg.sender;

        claimReward(index);

        stakes[account][index].balance -= amount;
        _unstake(account, amount);

        if (stakes[account][index].balance == 0) _removeStake(account, index);
    }

    /**
     * @dev Unstakes all tokens from all stake positions for a specific user.
     */
    function unstakeAll() public {
        address account = msg.sender;
        require(stakes[account].length > 0, "No stakes available.");

        uint256 amount;
        for (uint256 i = 0; i < stakes[account].length; i++) {
            StakeData memory info = stakes[account][i];
            require(info.expiry <= block.timestamp, "Can't unstake all");
            amount += info.balance;
        }

        require(amount > 0, "Nothing to unstake.");
        _unstake(account, amount);

        // remove all stakes
        delete stakes[account];
    }

    /**
     * @dev Calculates the claimable rewards for a user.
     * @param account The user's address.
     * @return The claimable rewards amount.
     */
    function getClaimable(address account) public view returns (uint256) {
        uint256 amount;
        for (uint256 i = 0; i < stakes[account].length; i++) {
            amount += calculateReward(account, i);
        }

        return amount;
    }

    /**
     * @dev Claims the reward for a specific stake position.
     * @param index The index of the stake position.
     */
    function claimReward(
        uint256 index
    ) public warmupPeriodEnded(msg.sender, index) {
        address account = msg.sender;

        uint256 amount = calculateReward(account, index);
        if (amount > 0) {
            stakes[account][index].lastClaimedEpoch = currentEpoch;
            _claimReward(account, amount);
        }
    }

    /**
     * @dev Claims all claimable rewards for a specific user.
     */
    function claimAll() external {
        address account = msg.sender;
        uint256 amount = getClaimable(account);
        require(amount > 0, "Nothing to claim.");

        _claimAll(account, amount);
    }

    /**
     * @dev Calculates the reward for a specific stake position.
     * @param account The user's address.
     * @param index The index of the stake position.
     * @return The calculated reward amount.
     */
    function calculateReward(
        address account,
        uint256 index
    ) public view returns (uint256) {
        StakeData memory info = stakes[account][index];

        if (info.expiry > block.timestamp) return 0;

        uint256 multiplier = epochs[currentEpoch - 1].rewardToStakedRatio -
            epochs[info.lastClaimedEpoch - 1].rewardToStakedRatio;

        return intoUint256(ud(info.balance) * ud(multiplier));
    }

    /**
     * @dev Starts the next epoch if applicable.
     */
    function startNextEpoch() external {
        // check if next month has started to update total rewards
        if (_hasMonthStarted()) _setEpochRewards();

        // checks if next epoch has started to distribute rewards
        if (epochs[currentEpoch].end <= block.timestamp) {
            epochs[currentEpoch].staked = totalStaked;

            epochs[currentEpoch]
                .rewardToStakedRatio = _calculateRewardToStaked();

            currentEpoch++;
            _initializeEpoch();

            emit StartNextEpoch(currentEpoch);
        }
    }

    /**
     * @dev Gets the total number of pages for reinvest eligibility.
     * @return The total number of pages.
     */
    function getTotalPages() external view returns (uint256) {
        uint256 count;
        for (uint i = 0; i < reinvestSubsList.length; i++) {
            address user = reinvestSubsList[i];
            uint256 amount = getClaimable(user);

            if (amount >= autoReinvestThreshold) count++;
        }

        if (pageSize == 0 || count == 0) return 0;
        return (count / pageSize) + 1;
    }

    /**
     * @dev Gets the list of eligible users for auto-reinvest on a specific page.
     * @param _pageNo The page number.
     * @return An array of eligible users and their balances.
     */
    function getEligibleUsers(
        uint256 _pageNo
    ) external view returns (address[] memory, uint256[] memory) {
        require(_pageNo > 0, "Invalid page number");
        uint256 start = (_pageNo - 1) * pageSize;
        uint256 end = start + pageSize;

        uint256 count;
        uint256[] memory indexes = new uint256[](reinvestSubsList.length);

        for (uint i = 0; i < reinvestSubsList.length; i++) {
            address user = reinvestSubsList[i];
            uint256 amount = getClaimable(user);

            if (amount >= autoReinvestThreshold) {
                indexes[count] = i;
                count++;
            }
        }

        if (start >= count) return (new address[](0), new uint256[](0));
        if (end > count) end = count;

        count = 0;
        address[] memory eligible = new address[](end - start);
        uint256[] memory balances = new uint256[](end - start);

        for (uint i = start; i < end; i++) {
            address user = reinvestSubsList[indexes[i]];
            uint256 amount = getClaimable(user);

            eligible[count] = user;
            balances[count] = amount;
            count++;
        }

        return (eligible, balances);
    }

    /**
     * @dev Swaps reward tokens for BLOB tokens.
     * @param _amountIn The amount of reward tokens to swap.
     */
    function swap(uint256 _amountIn) external onlyOwner {
        uint256 blobBefore = IERC20(BLOB).balanceOf(address(this));

        _swap(USDC, BLOB, _amountIn, 0);

        uint256 blobAfter = IERC20(BLOB).balanceOf(address(this));
        uint256 amount = blobAfter - blobBefore;

        emit RewardSwapped(amount);
    }

    /**
     * @dev Updates stake positions for users who are eligible for auto-reinvest.
     * @param users An array of user addresses.
     * @param balances An array of stake balances.
     * @param rewards An array of reward amounts.
     */
    function updateReinvestStakes(
        address[] memory users,
        uint256[] memory balances,
        uint256[] memory rewards
    ) external onlyOwner {
        uint256 amount;
        for (uint i = 0; i < users.length; i++) {
            _updateAllClaimed(users[i]);
            rewardsPaidToUser[users[i]] += rewards[i];

            IERC20(SBLOB).transfer(users[i], balances[i]);
            _addStakePosition(users[i], balances[i]);

            amount += balances[i];
        }

        totalStaked += amount;
        totalRewardsPaid += amount;
    }

    /**
     * @dev Reinvests claimable rewards for a user.
     */
    function reinvest() external {
        address account = msg.sender;

        uint256 amount = getClaimable(account);
        require(amount > 0, "Nothing to reinvest.");

        _updateAllClaimed(account);

        totalRewardsPaid += amount;
        rewardsPaidToUser[account] += amount;

        uint256 blobBefore = IERC20(BLOB).balanceOf(address(this));

        _swap(USDC, BLOB, amount, 0);

        uint256 blobAfter = IERC20(BLOB).balanceOf(address(this));
        uint256 _blobAmount = blobAfter - blobBefore;

        _addStake(account, _blobAmount);

        emit Reinvest(account, amount);
    }

    /**
     * @dev Withdraws funds from the contract to an external account.
     * @param account The recipient's address.
     * @param token The token to withdraw.
     * @param amount The amount to withdraw.
     */
    function withdrawFunds(
        address account,
        address token,
        uint256 amount
    ) external onlyOwner {
        require(account != address(0), "Invalid address!");
        require(IERC20(token).balanceOf(address(this)) >= amount);
        IERC20(token).transfer(account, amount);
    }

    /**
     * @dev Adds stake for a user and updates their staking position.
     * @param account The user's address.
     * @param amount The amount to stake.
     */
    function _addStake(address account, uint256 amount) internal {
        bool success = IERC20(SBLOB).transfer(account, amount);
        require(success, "Transfer Failed");

        totalStaked += amount;

        _addStakePosition(account, amount);
    }

    /**
     * @dev Adds a new staking position for a user.
     * @param account The user's address.
     * @param amount The staked amount.
     */
    function _addStakePosition(address account, uint256 amount) internal {
        totalStakesByUser[account] += amount;
        stakes[account].push(
            StakeData({
                epochNumber: currentEpoch,
                balance: amount,
                start: block.timestamp,
                expiry: block.timestamp + warmupPeriod,
                lastClaimedEpoch: currentEpoch
            })
        );
    }

    /**
     * @dev Checks if the current month has started.
     * @return A boolean indicating if the month has started.
     */
    function _hasMonthStarted() internal view returns (bool) {
        return (IDateTime(datetime).getDay(block.timestamp) == 1);
    }

    /**
     * @dev Sets the rewards for the current epoch.
     */
    function _setEpochRewards() internal {
        totalRewardsLeft += latestTreasuryReward;
        amountPerEpoch = totalRewardsLeft / 366;
        latestTreasuryReward = 0;

        emit UpdateEpochReward(amountPerEpoch);
    }

    /**
     * @dev Swaps tokens using the Uniswap router.
     * @param _tokenIn The token to swap from.
     * @param _tokenOut The token to swap to.
     * @param _amountIn The amount of tokens to swap.
     * @param _amountOutMin The minimum amount of tokens to receive.
     */
    function _swap(
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn,
        uint256 _amountOutMin
    ) internal {
        IERC20(_tokenIn).approve(routerAddress, _amountIn);

        address[] memory path;
        if (_tokenIn != address(swapper) && _tokenOut != address(swapper)) {
            path = new address[](3);
            path[0] = _tokenIn;
            path[1] = swapper;
            path[2] = _tokenOut;
        } else {
            path = new address[](2);
            path[0] = _tokenIn;
            path[1] = _tokenOut;
        }

        // Make the swap
        IUniswapV2Router02(routerAddress)
            .swapExactTokensForTokensSupportingFeeOnTransferTokens(
                _amountIn,
                _amountOutMin,
                path,
                address(this), // Tokens are stored in this contract
                block.timestamp + 10 minutes
            );
    }

    /**
     * @dev Calculates the reward-to-staked ratio for the current epoch.
     * @return The calculated ratio.
     */
    function _calculateRewardToStaked() internal view returns (uint256) {
        uint256 ratio = intoUint256(
            ud(epochs[currentEpoch].distribute) /
                ud(epochs[currentEpoch].staked)
        );

        return (ratio + epochs[currentEpoch - 1].rewardToStakedRatio);
    }

    /**
     * @dev Initializes the current epoch with default values.
     */
    function _initializeEpoch() internal {
        epochs[currentEpoch] = Epoch({
            staked: 0,
            duration: epochDuration,
            end: block.timestamp + epochDuration,
            distribute: amountPerEpoch,
            rewardToStakedRatio: 0
        });

        totalRewardsLeft -= amountPerEpoch;
    }

    /**
     * @dev Unstakes tokens from a user's account.
     * @param account The user's address.
     * @param amount The amount to unstake.
     */
    function _unstake(address account, uint256 amount) internal {
        bool getBackSBlob = IERC20(SBLOB).transferFrom(
            account,
            address(this),
            amount
        );
        require(getBackSBlob, "Transfer Failed");

        bool sendBlob = IERC20(BLOB).transfer(account, amount);
        require(sendBlob, "Transfer Failed");

        totalStaked -= amount;
        totalStakesByUser[account] -= amount;

        emit Unstake(account, amount);
    }

    /**
     * @dev Removes a staking position from a user's account.
     * @param account The user's address.
     * @param index The index of the stake position.
     */
    function _removeStake(address account, uint256 index) internal {
        require(index < stakes[account].length);
        stakes[account][index] = stakes[account][stakes[account].length - 1];
        stakes[account].pop();
    }

    /**
     * @dev Claims and transfers reward to a user's account.
     * @param account The user's address.
     * @param amount The amount of rewards to claim.
     */
    function _claimReward(address account, uint256 amount) internal {
        bool success = IERC20(USDC).transfer(account, amount);
        require(success, "Transfer Failed");

        totalRewardsPaid += amount;
        rewardsPaidToUser[account] += amount;

        emit ClaimRewards(account, amount);
    }

    /**
     * @dev Claims all claimable rewards for a user's account.
     * @param account The user's address.
     * @param amount The total claimable amount.
     */
    function _claimAll(address account, uint256 amount) internal {
        if (amount == 0) return;

        _claimReward(account, amount);
        _updateAllClaimed(account);
    }

    /**
     * @dev Updates the "last claimed epoch" value for all staking positions of a user.
     * @param user The user's address.
     */
    function _updateAllClaimed(address user) internal {
        for (uint256 i = 0; i < stakes[user].length; i++) {
            if (stakes[user][i].expiry <= block.timestamp) {
                stakes[user][i].lastClaimedEpoch = currentEpoch;
            }
        }
    }
}
