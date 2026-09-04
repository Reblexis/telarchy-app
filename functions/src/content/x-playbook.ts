/**
 * What is measured to travel on X for a founder in Telarchy's space: the
 * knowledge the workbench's Ask chat answers from (docs/x-workbench.md,
 * "Asking it what to post"). Distilled from the research record kept in the
 * Telarchy umbrella, notes/x-posts-what-works-2026-09-03.md (five parallel
 * researchers, 2026-09-03: X's published ranking code, large-sample
 * benchmarks, a 281-post sample read from X, comparable founders' posts, YC
 * primary sources). Every number is verbatim from its source there. Revise
 * this when that record is revised, not from memory.
 */
export const X_PLAYBOOK = `PLAYBOOK: what gets attention on X for a founder in this space (measured, 2026-09-03)

WHERE HE STARTS
- His X account has Premium, about one follower, and one post (2026-08-12) with 1 like and 0 replies. X is a channel he has to build, not one he has.
- Telarchy: Season 0 runs to 2026-10-02 with a 1,000 USD pool (500/250/125/75/50). On 2026-09-03: 244 active markets, 233 active agents, 289 trades in the week, 4 weekly active verified human traders, 10 Manifold imports, 0 USD revenue in 30 days.

HOW X RANKS A POST (the code X published on 2026-08-13, github.com/xai-org/x-algorithm)
- Score = sum over actions of weight x predicted probability, per viewer. Weights: like 0.5, repost 1.0, reply 5.0 (20.0 when viewer and author follow each other and the post is an original), quote 5.0, share via DM 5.0, share via copy link 20.0, follow author 4.0, click into post 0.4, open link 0.2, dwell 0.05, not dwelled -0.02, not interested -43.2, block -31.2, mute -58.8, report -234.0.
- A post whose weighted sum is negative sorts below every post with any positive expectation. Musk, 2024-12-27: if credible verified accounts mute or block you more than they like you, reach declines significantly.
- Replies and reposts are dropped from the For You feed of anyone who does not follow the author; followers see them at 0.75x. A reply reaches the thread's readers and nobody else. X's head of product (2026-03-18) on reply ranking: "no logic, no signal, just garbage".
- Author diversity: an author's second post in one feed scores 0.625x, third 0.4375x, floor 0.25x. Spacing beats volume.
- New-author boost: an original post from an author with at most 1,000 followers, under 24 hours old, under 1,000 home impressions, is lifted to slot 15 or 16 once per feed request, if it was retrieved at all. The only deliberate help a new account gets, and it lasts 24 hours per post.
- Links: no rule in the code (Musk, 2026-07-29: not penalized "for over a year"), but opening a link is worth 0.2 and a click that ends the session lowers every other predicted action. Post the substance, link in the first reply.
- Posts older than 48 hours leave For You. No Premium parameter exists in the ranking code.

WHAT LARGE SAMPLES SAY (Buffer, 18.8 million posts, 71,000 accounts, Aug 2024 to Aug 2025, and others)
- Regular accounts: median under 100 impressions and a 0% median engagement rate since March 2025. Premium: about 600 impressions, about 0.49%. Premium+: over 1,550. "Subscriber status influenced reach more than audience size."
- By post type on Premium: text about 0.90%, video about 0.85%, image about 0.42%, link about 0.28%. Regular-account link posts: 0% median since March 2025.
- Half of all X posts get 4 or fewer engagements (mean 328, standard deviation 5,159). The median is the only honest summary; expect zero.
- Posting at least once a week for 20 or more of 26 weeks gave 5x the median engagement per post of accounts active 4 weeks or fewer.
- Threads: 1.89% vs 0.67% for single text posts (Ordinal, 87,528 posts); 2.1x (SociaVault). Two vendor samples, same direction; use a thread only when the content needs one.
- 100 to 200 characters had the highest engagement rate (1.09%, one sample). Replying to comments on your own post: +8%, the least certain result. Time of day: three large studies disagree, none gives a magnitude, not worth optimising.
- No large-sample measurement exists for questions in the text, numbers in the text, hook grammar, or reply-guy growth. Figures in circulation for those have no source.

OUR OWN SAMPLE (281 posts read from X, 174 authors, within-author check over 13 authors with 5+ posts, likes divided by the author's own median)
- Link in the body: 0.36x (n=28 vs 81). Holds in every cut. Strongest effect.
- Being a reply: 0.12x (n=15 vs 94).
- Lines: one line 0.58x, two to four 1.00x, five or more 3.88x (n=8). Under 100 characters 0.47x, 100 to 280 characters 1.05x.
- Quote post 1.30x (weaker). Emoji 0.73x (weaker). A number in the text: no effect within author. "I" and "we" in the text: no effect once the author is fixed; the raw difference was who posts, not what was written.
- The sample is what search engines indexed, so it is survivors from mostly big accounts; the base rate (median 90 likes) says nothing about a new account.

WHAT COMPARABLE FOUNDERS' TOP POSTS LOOK LIKE (18 posts: Coplan, Silver, Levels, Marc Lou, Altman, Graham, Garry Tan, Tony Dinh, Postma, Yongfook, Tibo)
- First line carries the whole meaning; a number in the first 60 characters in 10 of 18; no link in the body in 16 of 18; single post rather than thread in 13 of 18.
- Structures, most frequent first: (1) milestone with three hard numbers ("Reached $10,000 MRR after 3 weeks with 318 customers @ ~$31/mo"; small candid numbers work: "5140 visitors, $2063 revenue, 53 members" at 15K followers); (2) "N ago ... now" reversal; (3) working demo with the prompt quoted, link in reply (Levels' flight simulator, Tony Dinh's live banner: 4,000 followers in 48 hours at ~1,000 followers); (4) victory lap after a resolved event, best with the caveat attached (Silver: "Pretty good, I guess?"); (5) a test the reader can run ("One way you can tell X is because Y"); (6) someone else's number first, then the lessons; (7) quote-post a bigger account's complaint with the thing built to answer it, within a day (Marc Lou's TrustMRR, 2M views: "it gave people a story"); (8) a relayed testimonial as the whole post.
- Founders' own rules: Marc Lou, "Convey meaning in the first sentence", "Add space between lines", "Wave a clear outcome". Levels: "Being honest is a better marketing strategy than a marketing strategy"; at 300K+ followers "often many tweets get like two likes". Harry Dry: @mentions and hashtags make a post "look so much like an advert that no one's ever going to retweet it". Arvid Kahl: "engage to empower, not to debate". Tony Dinh: "Every feature I publish became a marketing tweet".
- Small accounts with numbers: 30 to 1,000+ followers in 14 days by replying ("A good reply on a large account can outperform anything you post to your own tiny audience"; the fortnight "probably wasn't profitable"); 1,200 followers in 2.5 months at 10 comments a day, 20 demo calls, 2 customers.
- Forecasting-specific genres that recur: the resolved-market post with the miss admitted; "best and worst takes of the year" self-grading; a stated public forecast with method; the correction post. Never boast a forecasting record without the public track record beside it (LessWrong: "People who avoid forecasting accountability shouldn't boast about their forecasting performance"). Manifold's founders have 220 to 5,000 followers on X and no viral post; Kalshi's reach on X is paid placement.

WHAT YC SAYS (primary sources only; YC has published almost nothing about posting on X specifically)
- Launch now and keep launching. Kat Manalac: "the answer is ASAP it's probably right now"; "I want to destroy the idea that launching is just this one moment in time"; Airbnb "launched three times before they really started to get users". Stripe and Glossier hit every launch button on every release.
- Write like you talk: "do not talk like a marketing robot people hate that". Paul Graham: "just don't let a sentence through unless it's the way you'd say it to a friend"; "If you say nothing simply, it will be obvious".
- Lead with what, not why, in one sentence: "start with the company name and what you do ... just get to the point". Garry Tan: "meaningless jargon is the number one issue I spend time trying to fight when helping startups".
- Launch HN rules transfer: "Be humble. Don't say nice things about yourselves"; "When criticized, act like the critics are doing you a favor"; "Make sure your friends don't post booster comments".
- Broadcasting is not distribution. Gustaf Alstromer: "startups don't take off by themselves ... you have to manually recruit your customers". Graham: "The Big Launch ... usually doesn't work. All you need from a launch is some initial core of users." Posting is a search for the people to then DM one by one.
- No press before traction; never pay bloggers or influencers early. "Building in public" appears in no YC primary source.

THE PLAN FOR HIM
- Phase 1, until about 300 followers and 50 mutuals: replies. An original from a follower-less account is retrieved for nobody, so the new-author boost has nothing to lift. Run the workbench's search loop, answer 10 to 20 threads a day where a number or a counterexample from Telarchy adds something, follow back everyone who engages. Falsifier: under 300 followers by 2026-10-15 with 20 or more replies a day on record means replies do not work in this niche.
- Phase 2: two or three originals a day, spaced hours apart, every week for months. Types in order: the market called it / missed it (with the miss admitted, floor link in the reply); a test the reader can run; a milestone with three honest small numbers, weekly with the deltas; a working demo with the prompt quoted, link in reply, video as proof; quote-post a bigger account's complaint with the thing built; the Season 0 result post on 2026-10-02 ("We paid $1,000 to the people who predicted our own metrics best"); correction posts whenever a market or he was wrong in public.
- Reuse verbatim once there is an audience: "You can now get paid by my company without ever talking to me."
- Rules for every original: meaning in the first line; a real number in the first 60 characters when there is one; two to four lines, 100 to 280 characters; text only, link in the first reply; no hashtags, no @mentions of big accounts, no emoji; no pitch, nothing that reads as marketing; the operator pitch is the set of metrics a company cares about, never "one number"; admit the miss beside the hit; never bait, never rage, never fight a critic (one credible mute costs more than a hundred likes); reply to everyone who replies within the first hours; post inside the 24-hour new-author window when the audience is awake.
- Falsifiers: over the first 30 originals, a median under 600 impressions means the account is not being retrieved (phase 1 was cut short), not that the copy failed; a median above 600 with fewer than 3 replies per post is a copy problem. One post under 100 impressions is noise; ten in a row is not. Log every post at 24 hours and at 7 days so the next version of this runs on his own base rate.

WHERE THE SOURCES DISAGREE
- Replies as growth: the code filters replies out of strangers' feeds, small founders report replies grew them fastest. Both hold: replies reach the thread, enough when the alternative is nobody.
- Premium: a measured 6x reach gap, no Premium parameter in the ranker. Keep it, do not expect it to rescue a post.
- Numbers: ten of eighteen top founder posts lead with one; within author our sample shows no effect. Milestone numbers people understand travel; a number as decoration does nothing.
- Links: Musk says no penalty; Buffer measures 0% median on non-Premium link posts; our sample 0.36x. The measurement wins.`;
