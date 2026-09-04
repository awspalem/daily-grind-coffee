# The Daily Roast — Marketing Material

Copy and content assets for the [dailyroast.in](https://dailyroast.in) storefront.
Everything here is plain Markdown so it can be pasted into the CMS, the newsletter
tool, or social schedulers without reformatting.

## Contents

| File | Use |
| --- | --- |
| `brand-voice.md` | Tone, vocabulary, do/don't list, boilerplate |
| `launch-announcement.md` | Bangalore roastery launch — press blurb, site banner, email |
| `newsletter-templates.md` | Reusable "Weekly Roast Notes" email skeletons |
| `social-captions.md` | Instagram / WhatsApp captions for drops and brew content |
| `blog/` — *moved* | The 10 posts now live in `apps/storefront/content/blog/` and are built into `/blog/` pages by `scripts/seo-blog.mjs` (see `scripts/generate-seo.mjs`). Edit the Markdown there; front matter is `title`, `slug`, `description`, `date` (YYYY-MM-DD — future dates are held back until they arrive), `tags`, `cta_label`, `cta_href`. |

## Blog posts

Source: `apps/storefront/content/blog/*.md` → published at `https://dailyroast.in/blog/<slug>`.

| # | Slug | Angle | Primary product tie-in |
| --- | --- | --- | --- |
| 01 | `what-makes-coffee-single-origin` | Education / beginner | Single Origin category |
| 02 | `reading-a-roast-meter` | Education | Roast meters on every product |
| 03 | `honey-process-explained` | Education / process | Chikmagalur Attikan, Araku Valley |
| 04 | `south-indian-filter-coffee-guide` | How-to / culture | Chikmagalur Attikan, Dawn Patrol |
| 05 | `pour-over-at-home-v60` | How-to / brewing | Ethiopia Yirgacheffe, Colombia Huila |
| 06 | `cold-brew-at-home` | How-to / seasonal | Glacier Steep Cold Brew Blend |
| 07 | `dialing-in-espresso` | How-to / advanced | Midnight Runner Espresso |
| 08 | `why-freshness-beats-everything` | Brand / trust | Whole catalogue, subscription |
| 09 | `building-a-coffee-subscription-that-fits` | Product / conversion | Subscriptions |
| 10 | `meet-maya-ai-barista` | Product / differentiation | Maya assistant |

Each post ends with an internal-link block cross-referencing the others and a
call-to-action into the shop.
