-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('PENDING', 'ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USDC', 'CUSD');

-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('ON_TIME', 'LATE', 'MISSED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'STUDY', 'UNPAID', 'COMPASSIONATE');

-- CreateTable
CREATE TABLE "Employer" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT,
    "walletAddress" TEXT,
    "companyName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "industry" TEXT,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "treasuryContractAddress" TEXT,
    "checkInWindowStart" TEXT NOT NULL DEFAULT '07:00',
    "checkInWindowEnd" TEXT NOT NULL DEFAULT '10:00',
    "workingDaysPerMonth" INTEGER NOT NULL DEFAULT 22,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "absentPenaltyPercent" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "twoFaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT,
    "walletAddress" TEXT,
    "employerId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "monthlySalary" TEXT NOT NULL,
    "dailyRate" TEXT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USDC',
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'PENDING',
    "inviteCode" TEXT,
    "inviteExpiry" TIMESTAMP(3),
    "ipfsDocHash" TEXT,
    "phoneNumber" TEXT,
    "emergencyContact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "timestamp" TIMESTAMP(3),
    "status" "CheckInStatus" NOT NULL DEFAULT 'ON_TIME',
    "txHash" TEXT,
    "amount" TEXT,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRelease" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "checkInId" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USDC',
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ipfsDocHash" TEXT NOT NULL,
    "onChainId" INTEGER,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "txHash" TEXT,
    "rejectionReason" TEXT,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "totalDays" INTEGER NOT NULL,
    "note" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvanceRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "outstandingBalance" TEXT NOT NULL DEFAULT '0',
    "reason" TEXT NOT NULL,
    "isLoan" BOOLEAN NOT NULL DEFAULT false,
    "onChainId" INTEGER,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "employerId" TEXT,
    "employeeId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employer_clerkUserId_key" ON "Employer"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Employer_walletAddress_key" ON "Employer"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Employer_email_key" ON "Employer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_clerkUserId_key" ON "Employee"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_walletAddress_key" ON "Employee"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_inviteCode_key" ON "Employee"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_employeeId_date_key" ON "CheckIn"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryRelease_checkInId_key" ON "SalaryRelease"("checkInId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRelease" ADD CONSTRAINT "SalaryRelease_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRelease" ADD CONSTRAINT "SalaryRelease_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "CheckIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceRequest" ADD CONSTRAINT "AdvanceRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
