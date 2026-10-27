// Signup regions. US: state required (state-level rules), all states, DC and territories. Canada: provinces and territories, optional.
// Other countries: optional free text. The country names typed in "Other" are mapped so the US and Canada rules can't be skipped.
type Region = [code: string, name: string];
const byName = (a: Region, b: Region) => a[1].localeCompare(b[1]);

export const COUNTRIES: Region[] = [
	['US', 'United States'],
	['CA', 'Canada'],
	['OTHER', 'Other country'],
];

export const US_STATES: Region[] = [
	['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
	['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
	['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
	['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
	['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
	['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
	['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
	['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'], ['PR', 'Puerto Rico'], ['UM', 'U.S. Minor Outlying Islands'], ['VI', 'U.S. Virgin Islands'],
];
US_STATES.sort(byName);

export const CA_PROVINCES: Region[] = [
	['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'], ['NB', 'New Brunswick'], ['NL', 'Newfoundland and Labrador'], ['NS', 'Nova Scotia'],
	['NT', 'Northwest Territories'], ['NU', 'Nunavut'], ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Quebec'], ['SK', 'Saskatchewan'], ['YT', 'Yukon'],
];
CA_PROVINCES.sort(byName);

const REGIONS: Record<string, Region[]> = { US: US_STATES, CA: CA_PROVINCES };

/** The regions a country offers, by code. Empty for other countries. */
export const regionCodes = (country: string) => new Set((REGIONS[country] ?? []).map(([code]) => code));

const ALIASES: Record<string, string> = {
	us: 'US', usa: 'US', unitedstates: 'US', unitedstatesofamerica: 'US', america: 'US',
	ca: 'CA', canada: 'CA',
};

/** 'US', 'CA', or the typed country name. Empty for blank input. */
export const countryCode = (raw: string) => {
	const typed = raw.trim();
	return ALIASES[typed.toLowerCase().replace(/[.\s]/g, '')] ?? typed;
};
