// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IAttendanceStub {
    function mint(address to, address collection, uint256 ticketId)
        external
        returns (uint256 stubId);
}
