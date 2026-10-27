-- Rename the site currency from COIN "Coins" to DBLN "Dabloons". Ledger rows point at currency ids, so they follow automatically.
UPDATE "currencies" SET "code" = 'DBLN', "name" = 'Dabloons' WHERE "code" = 'COIN';
