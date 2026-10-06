-- The most one booking may ask for was capped at 20 (§136). A business may
-- sell a thing by the hundred — prints, tickets, seats — so the ceiling is
-- now 1000 (§155). The floor stays at 2: "several" means more than one.
ALTER TABLE "services" DROP CONSTRAINT "services_quantity_check";
ALTER TABLE "services"
    ADD CONSTRAINT "services_quantity_check" CHECK (
        ("quantityMode" = 'SINGLE' AND "maxQuantity" = 1)
        OR ("quantityMode" <> 'SINGLE' AND "maxQuantity" BETWEEN 2 AND 1000)
    );
