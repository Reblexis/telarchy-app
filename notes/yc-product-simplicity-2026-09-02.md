# What YC recommends about product simplicity (for the metric schedule dialog)

Date: 2026-09-02. Procedure: yc-recommends. Primary sources only (YC Library,
YC blog, YC YouTube, paulgraham.com). Every imperative below carries a
verbatim quote from a fetched source; where YC has little to say, that is
stated rather than filled in.

## 1. The question

Telarchy's owner dialog for a metric's market schedule (which dates a metric
is priced on) crams five things into one modal: a settlement-lag question,
the list of existing schedules with Stop buttons, a 6-way "every hour / day /
week / month / year / once" picker, a "this period / next period" picker, a
liquidity field, and a "remove metric" danger row. The owner called it
"horribly unintuitive and too bloated". What does YC recommend about product
simplicity, feature creep, defaults vs. configurability, and designing the
first version of a product surface so that a new user gets it immediately?

## 2. What YC recommends

### 2.1 A surface has one leading function; a second function makes it confusing

Dominika Blackappl (YC Part-Time Partner), "Practical Design: MVP Spec",
ycombinator.com/blog:

> "A product is a manifestation of a function."
> "Every product has one leading function. Having multiple functions in one product is confusing."
> "Too many features confuse an understanding of a product purpose."
> "An MVP needs to be a complete story with a clear purpose, or function, and with just the right set of features to promote this function."

Paul Graham, "Design and Research":

> "If a design represents an idea that fits in one person's head, then the idea will fit in the user's head too."
> "Design begins by asking, who is this for and what do they need from it?"

### 2.2 Cut the spec; the test is whether a desperate user needs it to start

Michael Seibel, "How to Build an MVP" (YC Library, Io-how-to-build-an-mvp):

> "Second, write down your spec. If you think that there are five or ten features required in order to launch an MVP, write them all down."
> "Number three, cut that spec. After you write all that stuff down, go through each one of those items and ask yourself: does a truly desperate customer need that feature to start?"
> "You'd probably be surprised at how many features you can leave off for the second, third, or fourth version of your product and just get the basic stuff out first."
> "Don't fall in love with your MVP. It's gonna change. You're gonna iterate it. ... You wanna fall in love with your customer, with your user, not in love with the crappy initial product that you're building to start learning from that user."

Michael Seibel, "How to Plan an MVP" (YC Library 6f, video 1hHMwLxN6EM):

> "The second, extremely limited functionality. You need to condense down what your user needs, what your initial user needs, to a very simple set of things. A lot of times, founders wanna address all of their users' problems and all of their potential users, when in reality, they should just focus on a small set of initial users and their highest-order problems, and then ignore the rest until later."
> "Time box it. Say, okay, what happens if I want to launch in three weeks? Okay, well, the only things that could be on my spec are things I can build in three weeks. That makes your life a lot simpler. It allows you to remove all the features you can't build in three weeks."
> "Just cut the stuff that clearly isn't important. And if there's no non-important things, start cutting important things."

Numbers as given: time box of "three weeks" (6f) or "two weeks or a month or a month and a half" (Io); "five or ten features" is the size of spec he expects you to write down before cutting.

### 2.3 Users bring problems, not features; solve the underlying problem

Michael Seibel, "How to Plan an MVP", Q&A:

> "Never ask users for features. Never ask users to tell you what they want. It's not the user's job to come up with features. That's your job. The user's job is to give you problems."

Kevin Hale, "How to Build Products Users Love" (video v89K25A8QUU, auto-transcript):

> "You cannot help but get feature requests from people no matter like whatever opening or office you have in your product or app, right? people will like jam feature requests in there. ... Your job as a product person, an engineer, is to not just do what they say because that way you'll just be a slave is to figure out sort of deeply what are the reasons why underlying those things"

Paul Graham, "Design and Research":

> "You have to design for the user, but you have to design what the user needs, not simply what he says he wants."

Paul Graham, "Six Principles for Making New Things":

> "Figure out what the real problem is, and make sure you solve that."
> "Reddit solved the real problem, which was to tell people what was new and otherwise stay out of the way."

Michael Seibel, "Building Product" (YC Library 7s), on the same instinct applied to hard ideas:

> "most hard ideas can be restated as an easy idea if you just understand what bits of your hard idea are both useless and hard. And most of the time, there are useless and hard bits in hard ideas that can just be removed."

### 2.4 Every added control widens the knowledge gap; remove actions, remove anything that can go without losing meaning

Kevin Hale, "How to Build Products Users Love":

> "The gap between those is called the knowledge gap. ... That gap represents how intuitive your app is, right? You either get the user to increase their knowledge or you decrease the amount of knowledge that's needed to use your application. And often times as engineers and people who build and work on products, we think let's add new features. And new features only means let's increase the knowledge gap. So for us, we actually focus a lot on the other sort of direction."

Number as given: Wufoo spent "30% of our engineering time" on internal tools and helping people help themselves (the "decrease the knowledge needed" direction).

Garry Tan, "Design for Startups (part 1)" (YC Library 7G, video 9urYWGx2uNk):

> "One is: how do you remove actions? One of the things that Paul Graham really directly, you know, called out to me on our signup page back in 2008 was, 'Why the hell do you have a confirm password?' ... Why would you for this strange case that doesn't happen that often?"
> "If you remove that confirmed password, it actually will increase conversion on a signup flow by as much as 50 percent, on average. So it's significant. You know, cognitive load is an incredibly real issue."
> "one of the key principles that you can actually apply is, you know, just look at any design that you're doing and just try to figure out, you know, if it can be removed without taking away any meaning. So that includes, you know, text that includes lines, borders, you know, really anything."
> "good design is actually as little design as possible. So minimalism."
> "when you're forced to be simple you actually have to solve the real problem."
> "one of the most dangerous things in product development, period, is that if you don't have these priorities, you don't know what to cut."
> "People never are opinionated about what you want the next user to do."

Paul Graham, "Taste for Makers":

> "Good design is simple."
> "When you're forced to be simple, you're forced to face the real problem."
> "Ornament is not in itself bad, only when it's camouflage on insipid form."
> "It's rare to get things right the first time."

### 2.5 Ask what the minimum is that gets someone to push the button

Kevin Hale, "How to Improve Conversion Rates" (YC blog Startup School week 7 recap):

> "What do I have to put on this page to get someone to push the button? What's the minimum amount?"
> "Is there any information that I put on this page that keeps me from pushing the button, or is there any lack of information that keeps me from pushing the button?"
> "All of the principles and ideas that I'll talk about in this talk, actually can help you improve the conversion rates of almost anything, any user interface."
> "Can I just copy-paste a sentence on this page, this landing page, that I can put into an email and send it to my mom, and my mom goes, 'I understand what this is'."

### 2.6 Build a base to iterate from, put it in front of users, redesign

Paul Graham, "Design and Research":

> "You should get a prototype in front of users as soon as possible."
> "Design usually has to be under the control of a single person to be any good."
> "You're most likely to get good design if the intended users include the designer himself."

Paul Graham, "Startups in 13 Sentences":

> "Initially you have to choose between satisfying all the needs of a subset of potential users, or satisfying a subset of the needs of all potential users. Take the first."
> "Launch fast and iterate. It's a big mistake to treat a startup as if it were merely a matter of implementing some brilliant initial idea."

YC Library, "How To Get Your First Users" (ND):

> "The earliest version of your product only needs to do one thing: survive contact with a tiny group of people who might actually try it. You're not building the final form. You're building something that can evolve."
> "your first version shouldn't just be a minimum viable product. It should be a minimum evolvable product. Something simple that can respond to market pressures and evolve into a much more mature product."
> "Study your early users closely. You should be like an anthropologist that's discovered a hidden civilization."

Michael Seibel, "How to Plan an MVP":

> "All this is is a base to iterate from. That's it. It's just a starting point."
> "What's the key thing you wanna learn when you wanna get feedback on your MVP? Does it solve the problem I want it to solve? That's it."

### 2.7 On defaults vs. configurability specifically

YC has no piece that names "defaults vs. configurability" as a topic. The
closest primary material is above: PG's "design what the user needs, not
simply what he says he wants" (a default is the designer deciding), Seibel's
"does a truly desperate customer need that feature to start?", Kevin Hale's
knowledge gap (every option the user must understand widens it), and Garry
Tan's removal test. The Instagram analytics example in Seibel's "Building
Product" is the nearest concrete case: "pick five to ten simple stats" rather
than tracking "like 150 things your users can do", because "If your analytics
product has got too many analytics sitting in it in the beginning, it will be
hard to use." Treat the guidance on defaults as derived from those, not as a
YC doctrine stated in those words.

## 3. Where YC voices disagree or advice is conditional

- Blackappl vs. Seibel on how finished the first version is. Blackappl:
  "MVP stands for minimum viable product _not_ minimum viable prototype."
  and "A minimum viable product is a real product." Seibel: "launch
  something bad, quickly." Both cut features; they differ on polish. For
  an owner-facing surface used by a handful of people, Seibel's stage
  applies (pre-PMF, ~25 uniques/day), but Blackappl's "complete story with a
  clear purpose" is the test the dialog currently fails.
- Vision vs. surface. Seibel: "Vision big, MVP small" and "You should have
  a vision of everyone. You should have an MVP, very small." The API can
  keep the full schedule grammar (hourly, this/next period); the owner
  surface does not have to show it.
- Many user types. Kevin Hale: "Some users will love one thing and another
  will will another. ... focus on the people who are the most passionate
  especially in the early stages" and "Curtail your thing for them and
  eventually you'll figure out sort of universal values". PG says the same
  ("satisfying all the needs of a subset of potential users ... Take the
  first"). So it is not a contradiction to build the settlement lag for the
  one owner who asked; the disagreement is only about whether it becomes a
  question every owner must answer.
- The "minimum evolvable product" framing (ND) leans toward keeping the
  product able to change; it does not argue for exposing every option now.
  Evolvability is about the code and the founders' willingness to iterate,
  and the same piece calls the first version "Something simple".
- Garry Tan's removal test and Kevin Hale's "is there any lack of
  information that keeps me from pushing the button?" pull in opposite
  directions on a single field; both agree the arbiter is whether the user
  can act, not whether the field is defensible.

## 4. What YC would say about our situation

Our situation: pre-PMF, ~25 unique visitors/day, the owner surface is used
by a handful of workspace owners. "Every hour" and "this/next period" exist
because the API always had them, not because an owner asked. The
settlement-lag field exists because one owner asked (2026-08-31) for monthly
totals that need a few days of refunds. The "remove metric" row is there
because deleting is "the same kind of act as stopping its dates".

1. Give the dialog one leading function and move "remove metric" out.
   Blackappl: "Every product has one leading function. Having multiple
   functions in one product is confusing." The dialog's function is "which
   dates is this metric priced on"; deleting the metric is a different
   function even if it feels like the same kind of act, and PG's test ("an
   idea that fits in one person's head") fails once the modal is about
   both. Delete belongs on the metric itself, next to rename, not in the
   schedule dialog.

2. Run Seibel's cut on the pickers: "does a truly desperate customer need
   that feature to start?" No owner has asked for "every hour" or for
   "this period / next period", so by that test they leave the first
   version of this surface. The API keeps them ("Vision big, MVP small");
   the dialog offers the cadences owners actually use, with one default
   preselected, and anything else lives behind a secondary "more options"
   or stays API-only until an owner brings the problem. Garry Tan: "if you
   don't have these priorities, you don't know what to cut."

3. Turn the settlement lag from a question into a default. Seibel: "The
   user's job is to give you problems"; PG: "design what the user needs,
   not simply what he says he wants." The problem was "monthly totals need
   a few days of refunds", so the design answer is a sensible lag applied
   automatically to monthly schedules (with the value visible and editable
   only where it applies), not a field every owner must understand before
   pricing anything. Kevin Hale: "new features only means let's increase
   the knowledge gap."

4. Apply Garry Tan's removal test to every remaining element: "figure out
   if it can be removed without taking away any meaning." Candidates: the
   liquidity field (default it, show it only when the owner opens the
   advanced section), the Stop buttons on existing schedules (keep, that is
   the core function), any explanatory copy that defends the design rather
   than tells the owner what to do. Kevin Hale's question for the dialog:
   "What do I have to put on this page to get someone to push the button?
   What's the minimum amount?" Tan's confirm-password example (removing one
   field lifted signup conversion "by as much as 50 percent") is the
   reminder that a single extra input is not free.

5. Put the cut version in front of the handful of owners and watch, then
   redesign. PG: "You should get a prototype in front of users as soon as
   possible"; ND: "Study your early users closely"; Seibel's one feedback
   question: "Does it solve the problem I want it to solve? That's it." And
   do not defend the current modal: "Don't fall in love with your MVP."
   With a handful of owners this is a few conversations, not an experiment.

## 5. Sources

Fetched successfully and used:

- https://www.ycombinator.com/library/Io-how-to-build-an-mvp (Michael Seibel, "How to Build an MVP"; page is JS-rendered, text pulled via the r.jina.ai reader)
- https://www.ycombinator.com/library/6f-how-to-plan-an-mvp (Michael Seibel, "How to Plan an MVP", transcript; via r.jina.ai)
- https://www.youtube.com/watch?v=1hHMwLxN6EM (same talk, auto-subs via yt-dlp; used to confirm the library transcript)
- https://www.ycombinator.com/library/7s-building-product (Michael Seibel, "Building Product"; via r.jina.ai)
- https://www.ycombinator.com/library/ND-how-to-get-your-first-users (YC Library, "How To Get Your First Users"; via r.jina.ai)
- https://www.ycombinator.com/library/7G-design-for-startups-part-1 (Garry Tan, "Design for Startups part 1", transcript; via r.jina.ai)
- https://www.youtube.com/watch?v=9urYWGx2uNk (same Garry Tan talk, auto-subs via yt-dlp)
- https://www.youtube.com/watch?v=v89K25A8QUU (Kevin Hale, "How to Build Products Users Love", How to Start a Startup lecture 7, auto-subs via yt-dlp; quotes are from the auto-transcript so punctuation is approximate)
- https://www.ycombinator.com/blog/practical-design-mvp (Dominika Blackappl, "Practical Design: MVP Spec")
- https://www.ycombinator.com/blog/startup-school-week-7-recap-kevin-hale-on-conversion-rates-and-pricing/ (Kevin Hale, "How to Improve Conversion Rates" recap)
- https://www.paulgraham.com/taste.html (Paul Graham, "Taste for Makers")
- https://www.paulgraham.com/desres.html (Paul Graham, "Design and Research")
- https://paulgraham.com/13sentences.html (Paul Graham, "Startups in 13 Sentences")
- https://paulgraham.com/newthings.html (Paul Graham, "Six Principles for Making New Things")

Fetched, little or nothing usable for this question:

- https://paulgraham.com/start.html (Paul Graham, "How to Start a Startup"): only "Get a version 1 out as soon as you can." and "The only way to make something customers want is to get a prototype in front of them and refine it based on their reactions." Nothing on simplicity of a surface.
- https://www.ycombinator.com/blog/design-for-startups-by-garry-tan/ : announcement page only, no transcript.

Failed or not found:

- Direct WebFetch of the five YC Library pages returned only the page title (client-rendered); the r.jina.ai reader was used instead.
- No primary YC source found for Dalton Caldwell on "startups should do one thing", for Garry Tan on "minimum lovable product", or for an Aaron Epstein design talk; searches returned only third-party summaries, so none are cited.
- Search hits skipped as non-primary: Wikipedia "Feature creep", substack summaries, medium.com transcripts, startupclass.samaltman.com mirror, SlideShare decks.
