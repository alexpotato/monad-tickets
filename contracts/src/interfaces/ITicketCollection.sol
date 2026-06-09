// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ITicketCollection {
    struct Ticket {
        uint16 tier;
        uint256 facePrice;
        uint64 mintedAt;
        uint64 usedAt; // 0 until checked in
        uint256 lastSalePrice;
    }

    function eventStartTime() external view returns (uint64);
    function resaleCap() external view returns (uint256);
    function royaltyBps() external view returns (uint96);
    function organizer() external view returns (address);
    function ticket(uint256 tokenId) external view returns (Ticket memory);
    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice Privileged transfer used by the marketplace/auction on settlement.
    ///         Reverts for any other caller and for already-used tickets.
    function marketTransfer(address from, address to, uint256 tokenId, uint256 salePrice) external;

    /// @notice Mint a primary-sale ticket to a winner (used by primary auction).
    function mintTo(address to, uint16 tier, uint256 price) external returns (uint256 tokenId);
}
