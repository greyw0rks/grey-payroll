-- Archive the previous currency label without converting or deleting amounts.
ALTER TYPE "Currency" RENAME VALUE 'CUSD' TO 'LEGACY_ASSET';
