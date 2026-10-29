# Changelog

## 2026-10-29

Added link embeds for markets and pages, a changelog page and birthday days that match the month and year, and updated SSE syncing to reflect new API changes.

### Added

- Added oEmbed for public markets, so other sites can embed a market as a link card at `/oembed`
- Added Discord embeds for every page: a card with the title, the odds and a button back to the page, served from `/embed`
- Added a changelog page at `/changelog`, which shows each release's heading and summary

### Changed

- Updated SSE sync to send a custom user agent (`SSE_USER_AGENT`) and an optional login token (`SSE_API_TOKEN`) with every request to the SSE website
- Removed entries to request endpoints that are no longer needed
- Added Tailwind CSS and moved the layout, navbar, footer, shared components, home page and market page over to it
- Updated the birthday day list so it only shows days that exist for the chosen month, and for the birth year when one is entered
- Updated the site's structured data to use the page's own address

## 2026-10-28

Updated coloring on the leaderboard to show alumni in a different color than mentors, and to show the school year for each member, fixed many smaller bugs and made many small improvements to the site.

### Added

#### Development site
- Added seperate CSS rules for the development site so I don't get confused between the live and dev sites.
- Added functionality for alumni tracking and currency crediting for alumni. 
- Updated HTML meta tags to be more descriptive and show for each page, including the market's image for market pages. This improves link previews on social media and messaging apps like Discord.
- Reworked the market page to show the chart and headline chance more prominently, and to show the market's image in a larger size.
- Updated test script to use different roles on the dev site so that different conditions regarding permissions can be tested.

### Changed

- Updated font to be consistent accross the site
- Updated the final name "Monoglarket" to be used site-wide
- Added footer with copyright/privacy policy/terms of service links and build commit hash
- Reworked navbar to show more options without a more option when available, ensuring it renders properly on phones
- Reworked market page to show the chart and headline chance more prominently, and to show the market's image in a larger size
- Reworked leaderboard to show name colours for officers, staff, mentors, alumni and each school year (in that order)
- Updated profile page to show the member's name colour, and to show their SSE roles and school year more clearly. Also made the profile picture bigger
- Updated color consistency for Yes/No markets

## 2026-10-27

Initial release

### Accounts and onboarding

- Added sign in with google
- Added onboarding flow for new users
- Added inital profile page for users to view their information and edit their profile picture

### Legal
- Added "Take a break" so members can pause themselves for a set time. Only an admin can end a break early.
- Added intial commit of Terms of Service and Privacy Policy, available at `/terms` and `/privacy`.

### SSE integration

- Added intital version of SSE integration, to fetch the SSE API to get information on users, their memberships, event attendance, and officer/mentor status. This is used to credit users with the correct amount of currency for their memberships and event attendance, and to show their officer/mentor status on their profile and on the leaderboard.
- Added parsing and currency conversion for events, memberships and status.
- Parsed event locations and majors are parsed, and events are put into categories.

### Markets and trading

- Added an automated market maker (LMSR) to set prices, so any option can be bought or sold at any time.
- Added a double-entry ledger with integrity checks to record every coin movement, along with a full activity log.
- Added market types for yes/no, multiple options, dates, grouped questions with several winners, open-ended questions and people.
- Added market proposals for members, which moderators approve. Moderators can open, lock, schedule closing, edit, add or remove options, cancel and delete markets, and limit who can see a market to groups set up by admins.
- Added market resolution by a moderator or a trusted resolver, with uploaded proof. Results have a 24-hour dispute window before they become final, and can be re-decided during that window.
- Added a 5% fee for selling (cashing out) and a spending limit per member per market.
- Added a price chart, image and colours for each market, and a featured "headliner" market on the home page.
- Added live updates for prices and trades on open pages, so no refresh is needed.

### Earning and leaderboards

- Added currency earning for SSE membership, event check-ins (from 15 minutes before an event to 6 hours after) and site events. Rates can be set per event or per category.
- Added a weekly allowance.
- Added seven leaderboards: most currency, most money won, best single call, most markets won, most markets traded, most trades, and season profit. Admins set the seasons.
- Added personal history and visit summary pages.

### Community and moderation

- Added comments on markets, with a length limit and a rate limit.
- Added reporting for markets and comments, with a queue for moderators to work through.
- Added a moderation page for markets, and an admin page for blocks and breaks, coin grants and balance corrections, seasons, the weekly allowance, categories, groups and resolver access.

### Notifications

- Added in-app alerts for when a market a member holds is resolved, disputed, closing soon, overdue or cancelled.
- Added web push notifications for the same alerts, and made the site installable as an app.

### Site and deployment

- Added production deployment on Docker with Postgres and Caddy (automatic HTTPS), with nightly database backups.
- Added the build commit and legal links to every page footer, and a card image for link previews.
- Added SSE logos, a coin icon and a favicon.
- Added a seed script for the club's starting markets: campus Wi-Fi, SSE website downtime, printer ink, snow before December, event turnout, meeting length and term-end points.
- Added proof uploads of up to five 5 MB files per request.
