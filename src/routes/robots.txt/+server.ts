import { APP_ENV } from '$app/env/private';

// The dev site is kept out of search engines. Live allows crawling, as static/robots.txt did before.
const body = APP_ENV === 'dev' ? 'User-agent: *\nDisallow: /\n' : '# allow crawling everything by default\nUser-agent: *\nDisallow:\n';

export const GET = () => new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
