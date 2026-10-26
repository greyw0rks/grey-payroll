-- Keep historical treasury addresses and all historical financial amounts intact.
ALTER TABLE "Employer"
  ADD COLUMN "arcTreasuryAddress" TEXT,
  ADD COLUMN "arcEmployerWallet" TEXT,
  ADD COLUMN "arcChainId" INTEGER NOT NULL DEFAULT 5042002,
  ADD COLUMN "arcBindingChallenge" JSONB;
