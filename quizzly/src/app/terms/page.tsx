import Link from "next/link";

export const metadata = { title: "Terms" };

/** TEMPLATE — see the banner. Complete before operating publicly. */
export default function TermsPage() {
  return (
    <div className="min-h-dvh bg-ink-950">
      <header className="border-b border-ink-800">
        <div className="mx-auto max-w-3xl px-5 py-4">
          <Link href="/" className="text-sm text-ink-400 hover:text-ink-200">
            ← Home
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-5 py-10">
        <div className="mb-8 rounded-lg border border-amber-800 bg-amber-950/50 px-4 py-3 text-sm text-amber-200">
          <strong>Operator note:</strong> template. Replace the{" "}
          <code className="rounded bg-black/30 px-1">[BRACKETED]</code> fields,
          have it reviewed if you are charging money, and delete this banner.
        </div>

        <h1 className="text-3xl font-bold text-white">Terms of use</h1>
        <p className="mt-2 text-sm text-ink-500">Last updated: [DATE]</p>

        <div className="mt-8 space-y-8 text-ink-300">
          <section>
            <h2 className="text-xl font-semibold text-white">The basics</h2>
            <p className="mt-2 leading-relaxed">
              This service is provided by [LEGAL ENTITY NAME]. By creating an
              account or joining a game you agree to these terms. You must be
              [16 / your local digital age of consent] or over to hold an
              account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Your content</h2>
            <p className="mt-2 leading-relaxed">
              You keep ownership of the quizzes and questions you write. You give
              us only the permission needed to store and display them to the
              people you share them with. You are responsible for having the
              right to use anything you upload — including images you link to and
              text you paste in.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Acceptable use</h2>
            <p className="mt-2 leading-relaxed">Do not use this service to:</p>
            <ul className="mt-3 space-y-1.5 pl-5">
              <li className="list-disc">
                Harass, bully, or target anyone — including through nicknames or
                question content.
              </li>
              <li className="list-disc">
                Share unlawful material, or content you have no right to share.
              </li>
              <li className="list-disc">
                Attempt to break, overload, or gain unauthorised access to the
                service.
              </li>
              <li className="list-disc">
                Scrape or bulk-extract other people&apos;s content.
              </li>
            </ul>
            <p className="mt-3 leading-relaxed">
              Hosts of group quizzes have a moderation tool for checking
              submissions; using it is recorded and disclosed to contributors.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">
              AI-generated questions
            </h2>
            <p className="mt-2 leading-relaxed">
              Where AI generation is available, it produces <em>drafts</em>.
              Language models get facts wrong. You are responsible for checking
              anything generated before you put it in front of players, and we
              make no warranty about the accuracy of generated content.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">
              Availability and liability
            </h2>
            <p className="mt-2 leading-relaxed">
              The service is provided &quot;as is&quot;. We do not guarantee it
              will be uninterrupted or error-free. To the fullest extent the law
              allows, [LEGAL ENTITY NAME] is not liable for indirect or
              consequential loss. Nothing here limits liability for death or
              personal injury caused by negligence, for fraud, or for anything
              else that cannot lawfully be limited.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Ending it</h2>
            <p className="mt-2 leading-relaxed">
              You can delete your account at any time from Settings. We may
              suspend accounts that breach these terms. These terms are governed
              by the law of [JURISDICTION].
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">The software</h2>
            <p className="mt-2 leading-relaxed">
              Quizzly is open-source software under the MIT licence. The licence
              covers the code; these terms cover this hosted instance of it.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
