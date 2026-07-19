// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/EmployeeRegistry.sol";

contract EmployeeRegistryTest is Test {
    EmployeeRegistry public registry;

    address owner = address(this);
    address employer = makeAddr("employer");
    address employee = makeAddr("employee");
    address token = makeAddr("token");

    function setUp() public {
        registry = new EmployeeRegistry();
    }

    function test_register() public {
        registry.register(
            employee,
            employer,
            500_000 * 1e6,
            block.timestamp,
            token,
            EmployeeRegistry.EmploymentType.FULL_TIME
        );

        assertTrue(registry.employmentActive(employee));
        assertEq(registry.employerOf(employee), employer);

        (uint256 monthlyRate, uint256 startDate, address tkn) = registry.salaryRecord(employee);
        assertEq(monthlyRate, 500_000 * 1e6);
        assertEq(startDate, block.timestamp);
        assertEq(tkn, token);
    }

    function test_register_revertIfAlreadyActive() public {
        registry.register(employee, employer, 500_000 * 1e6, block.timestamp, token, EmployeeRegistry.EmploymentType.FULL_TIME);
        vm.expectRevert(EmployeeRegistry.AlreadyRegistered.selector);
        registry.register(employee, employer, 500_000 * 1e6, block.timestamp, token, EmployeeRegistry.EmploymentType.FULL_TIME);
    }

    function test_deactivate() public {
        registry.register(employee, employer, 500_000 * 1e6, block.timestamp, token, EmployeeRegistry.EmploymentType.FULL_TIME);
        registry.deactivate(employee, block.timestamp + 30 days);

        assertFalse(registry.employmentActive(employee));
    }

    function test_deactivate_revertIfNotRegistered() public {
        vm.expectRevert(EmployeeRegistry.NotRegistered.selector);
        registry.deactivate(employee, block.timestamp);
    }
}
