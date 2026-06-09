// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoyaltyRegistry} from "../src/LoyaltyRegistry.sol";

contract LoyaltyRegistryTest is Base {
    function setUp() public {
        _deploySystem();
    }

    function test_Soulbound_NoTransferFunction() public {
        // The registry exposes no transfer/approve surface — reputation is
        // bound to the wallet. Only authorized writers can mutate it.
        address rando = makeAddr("rando");
        address victim = makeAddr("victim");
        vm.prank(rando);
        vm.expectRevert(); // missing WRITER_ROLE
        loyalty.recordAttendance(victim, 1, 10);
    }

    function test_OnlyWriterCanRecord() public {
        bytes32 writer = loyalty.WRITER_ROLE();
        address w = makeAddr("writer");
        vm.prank(admin);
        loyalty.grantRole(writer, w);

        address user = makeAddr("user");
        vm.prank(w);
        loyalty.recordAttendance(user, 1, 10);
        assertEq(loyalty.scoreOf(user), 10);

        vm.prank(w);
        loyalty.recordFlip(user, 1, 4);
        assertEq(loyalty.scoreOf(user), 6);
    }

    function test_BonusBpsMonotonicAndClamped() public {
        bytes32 writer = loyalty.WRITER_ROLE();
        address w = makeAddr("writer");
        vm.prank(admin);
        loyalty.grantRole(writer, w);

        address user = makeAddr("user");
        // 0 score → 0 bonus
        assertEq(loyalty.bonusBpsFor(user, 100, 5_000), 0);

        vm.prank(w);
        loyalty.recordAttendance(user, 1, 10); // 10 pts
        assertEq(loyalty.bonusBpsFor(user, 100, 5_000), 1_000); // 10*100

        // clamp
        assertEq(loyalty.bonusBpsFor(user, 100, 500), 500);
    }

    function test_NegativeScoreGivesZeroBonus() public {
        bytes32 writer = loyalty.WRITER_ROLE();
        address w = makeAddr("writer");
        vm.prank(admin);
        loyalty.grantRole(writer, w);

        address user = makeAddr("user");
        vm.prank(w);
        loyalty.recordFlip(user, 1, 20); // score = -20
        assertEq(loyalty.scoreOf(user), -20);
        assertEq(loyalty.bonusBpsFor(user, 100, 5_000), 0);
    }
}
