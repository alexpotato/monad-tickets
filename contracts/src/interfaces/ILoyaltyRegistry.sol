// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ILoyaltyRegistry {
    function recordAttendance(address wallet, uint256 tokenId, int256 points) external;
    function recordFlip(address wallet, uint256 tokenId, int256 penalty) external;
    function scoreOf(address wallet) external view returns (int256);
    function bonusBpsFor(address wallet, uint256 bpsPerPoint, uint256 maxBonusBps)
        external
        view
        returns (uint256);
}
