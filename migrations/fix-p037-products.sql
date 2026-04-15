-- Correction des références P037 (Après Shampoing Élégance)
-- Bug: P037 était assigné à "Gel douche Shampoing 2 en 1" au lieu de "Après Shampoing"

-- Corriger le catalogue
UPDATE vf_catalog
SET nom = 'Après Shampoing Élégance 500ml'
WHERE ref = 'P037';

UPDATE vf_catalog
SET nom = 'Après Shampoing Élégance Recharge 5 L'
WHERE ref = 'P037-5000';

-- Corriger les mappings product_name
UPDATE vf_code_mappings
SET valeur = '037 Après Shampoing Élégance Recharge 5 L'
WHERE type = 'product_name'
  AND code_source LIKE 'P037-5000%';

-- Vérification
SELECT 'Catalogue P037:' as verification;
SELECT ref, nom FROM vf_catalog WHERE ref LIKE 'P037%' ORDER BY ref;

SELECT 'Mappings P037-5000:' as verification;
SELECT code_source, type, valeur
FROM vf_code_mappings
WHERE code_source LIKE 'P037-5000%'
ORDER BY code_source, type;
