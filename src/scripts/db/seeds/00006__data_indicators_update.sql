ALTER TABLE macro.indicators
ADD COLUMN active BOOLEAN DEFAULT true;

UPDATE macro.indicators
SET active = false
WHERE indicator_code = 'GOLDAMGBD228NLBM';
