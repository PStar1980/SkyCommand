BEGIN;

--delete from macro.indicators;

--Liquidity and Credit Conditions
insert into macro.indicators values ('NFCI','FRED','Chicago Fed National Financial Conditions Index','weekly',now());
insert into macro.indicators values ('ANFCI','FRED','Adjusted National Financial Conditions Index','weekly',now());
insert into macro.indicators values ('NFCICREDIT','FRED','Financial Conditions Index - Credit Subindex','weekly',now());
insert into macro.indicators values ('NFCIRISK','FRED','Financial Conditions Index - Risk Subindex','weekly',now());
insert into macro.indicators values ('NFCILEVERAGE','FRED','Financial Conditions Index - Leverage Subindex','weekly',now());
insert into macro.indicators values ('NFCINONFINLEVERAGE','FRED','Nonfinancial Leverage Subindex','weekly',now());
insert into macro.indicators values ('M1SL','FRED','M1 Money Supply','monthly',now());
insert into macro.indicators values ('M2SL','FRED','M2 Money Supply','monthly',now());
insert into macro.indicators values ('EFFR','FRED','Effective Federal Funds Rate','daily',now());
insert into macro.indicators values ('IORB','FRED','Interest Rate on Reserve Balances','daily',now());

--Interest Rates and Yield Curve
insert into macro.indicators values ('DGS3MO','FRED','3-Month Treasury Yield','daily',now());
insert into macro.indicators values ('DGS2','FRED','2-Year Treasury Yield','daily',now());
insert into macro.indicators values ('DGS3','FRED','3-Year Treasury Yield','daily',now());
insert into macro.indicators values ('DGS5','FRED','5-Year Treasury Yield','daily',now());
insert into macro.indicators values ('DGS7','FRED','7-Year Treasury Yield','daily',now());
insert into macro.indicators values ('DGS10','FRED','10-Year Treasury Yield','daily',now());
insert into macro.indicators values ('BAMLC0A1CAAA','FRED','AAA Corporate Bond Yield','daily',now());
insert into macro.indicators values ('BAMLC0A4CBBBEY','FRED','BBB Corporate Bond Yield','daily',now());
insert into macro.indicators values ('DFF','FRED','Federal Funds Effective Rate','daily',now());
insert into macro.indicators values ('DFEDTARL','FRED','Fed Funds Target Range Lower Bound','daily',now());
insert into macro.indicators values ('DFEDTARU','FRED','Fed Funds Target Range Upper Bound','daily',now());
insert into macro.indicators values ('MORTGAGE30US','FRED','30-Year Fixed Mortgage Rate','weekly',now());

--Inflation
insert into macro.indicators values ('CPILFESL','FRED','Core CPI (Ex Food & Energy)','monthly',now());
insert into macro.indicators values ('CPIAUCSL','FRED','Consumer Price Index (All Items)','monthly',now());
insert into macro.indicators values ('PCEPI','FRED','Personal Consumption Expenditures Price Index','monthly',now());
insert into macro.indicators values ('PCEPILFE','FRED','Core PCE Price Index','monthly',now());

--Growth
insert into macro.indicators values ('GDP','FRED','Gross Domestic Product','quarterly',now());
insert into macro.indicators values ('GDPC1','FRED','Real Gross Domestic Product','quarterly',now());
insert into macro.indicators values ('GNP','FRED','Gross National Product','quarterly',now());
insert into macro.indicators values ('INDPRO','FRED','Industrial Production Index','monthly',now());
insert into macro.indicators values ('TCU','FRED','Capacity Utilization','monthly',now());
insert into macro.indicators values ('PCE','FRED','Personal Consumption Expenditures','monthly',now());
insert into macro.indicators values ('PCEC96','FRED','Real Personal Consumption Expenditures','monthly',now());
insert into macro.indicators values ('GPDI','FRED','Gross Private Domestic Investment','quarterly',now());
insert into macro.indicators values ('PAYEMS','FRED','Nonfarm Payroll Employment','monthly',now());
insert into macro.indicators values ('BUSINV','FRED','Total Business Inventories','monthly',now());
insert into macro.indicators values ('USSLIND','FRED','Leading Economic Index (St. Louis Fed)','monthly',now());

--Labour Market
insert into macro.indicators values ('UNRATE','FRED','Unemployment Rate','monthly',now());
insert into macro.indicators values ('U6RATE','FRED','Underemployment Rate (U-6)','monthly',now());
insert into macro.indicators values ('CIVPART','FRED','Labor Force Participation Rate','monthly',now());
insert into macro.indicators values ('EMRATIO','FRED','Employment-Population Ratio','monthly',now());
insert into macro.indicators values ('ICSA','FRED','Initial Jobless Claims','weekly',now());
insert into macro.indicators values ('CCSA','FRED','Continuing Jobless Claims','weekly',now());
insert into macro.indicators values ('AHETPI','FRED','Average Hourly Earnings (Total Private)','monthly',now());
insert into macro.indicators values ('CES0500000003','FRED','Average Hourly Earnings','monthly',now());
insert into macro.indicators values ('JTSJOL','FRED','Job Openings (JOLTS)','monthly',now());
insert into macro.indicators values ('JTSHIR','FRED','Hires (JOLTS)','monthly',now());
insert into macro.indicators values ('JTSQUR','FRED','Quits (JOLTS)','monthly',now());

--Housing
insert into macro.indicators values ('HOUST','FRED','Housing Starts','monthly',now());
insert into macro.indicators values ('PERMIT','FRED','Building Permits','monthly',now());
insert into macro.indicators values ('CSUSHPISA','FRED','Case-Shiller Home Price Index','monthly',now());

--Commodities
insert into macro.indicators values ('DCOILWTICO','FRED','Crude Oil Prices (WTI)','daily',now());
insert into macro.indicators values ('GOLDAMGBD228NLBM','FRED','Gold Price (London Fix)','daily',now());

--Financial Stress
insert into macro.indicators values ('STLFSI4','FRED','St. Louis Fed Financial Stress Index','weekly',now());

COMMIT;
