import Link from "next/link";

export const metadata = { title: "Privacy" };

/**
 * TEMPLATE — must be completed before you operate this publicly.
 *
 * It accurately describes what the software does, which is the hard part and
 * the part only the code can tell you. It cannot know who *you* are, so the
 * operator-specific fields are marked and must be filled in. Publishing this
 * with the placeholders still in it is not a compliant privacy notice.
 *
 * See docs/LEGAL.md for the reasoning behind each data-handling decision.
 */
export default function PrivacyPage() {
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
          <strong>Operator note:</strong> this is a template. Replace every{" "}
          <code className="rounded bg-black/30 px-1">[BRACKETED]</code> field
          below and delete this banner before going live. The factual sections
          about what the software collects are accurate as written.
        </div>

        <h1 className="text-3xl font-bold text-white">Privacy notice</h1>
        <p className="mt-2 text-sm text-ink-500">
          Last updated: [DATE]
        </p>

        <div className="prose-quizzly mt-8 space-y-8 text-ink-300">
          <section>
            <h2 className="text-xl font-semibold text-white">Who we are</h2>
            <p className="mt-2 leading-relaxed">
              This service is operated by <strong>[LEGAL ENTITY NAME]</strong>,{" "}
              [REGISTERED ADDRESS]. For anything about your data, contact{" "}
              <strong>[CONTACT EMAIL]</strong>.
              [If you have appointed a Data Protection Officer, give their
              contact details here. If you are established outside the EU/UK but
              offer this service to people inside it, you must also name your
              Article 27 representative.]
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">
              Playing a quiz: what we collect
            </h2>
            <p className="mt-2 leading-relaxed">
              <strong>Players do not need an account and we do not ask for
              personal data.</strong> When you join a game we store:
            </p>
            <ul className="mt-3 space-y-1.5 pl-5">
              <li className="list-disc">
                The <strong>nickname</strong> you type in.
              </li>
              <li className="list-disc">
                The <strong>answers</strong> you give, and how quickly.
              </li>
              <li className="list-disc">Your score.</li>
            </ul>
            <p className="mt-3 leading-relaxed">
              We do not store your name, email address, IP address, or any
              device identifier against your play session, and we set no
              analytics or advertising cookies. If you choose a nickname that
              identifies you, that is the only identifying information in the
              record.
            </p>
            <p className="mt-3 leading-relaxed">
              Your browser keeps a short token in <em>session storage</em> so you
              can rejoin the same game after a refresh. It is deleted when you
              close the tab and never leaves your device except to rejoin that
              one game.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">
              Holding an account: what we collect
            </h2>
            <p className="mt-2 leading-relaxed">
              You only need an account to <em>create</em> quizzes. For account
              holders we store your email address, display name, a hashed
              password (we never store the password itself), the quizzes you
              write, and the history of games you host.
            </p>
            <p className="mt-3 leading-relaxed">
              A session cookie keeps you signed in. It is strictly necessary for
              the service to function, contains no tracking data, and is the only
              cookie this service sets.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">
              Why we&apos;re allowed to hold it
            </h2>
            <p className="mt-2 leading-relaxed">
              For account holders, we process your data to perform the contract
              you entered into by creating an account (UK/EU GDPR Article
              6(1)(b)). For players, the nickname and answers are processed on
              the basis of [legitimate interests — running the game you chose to
              join / the contract with the organisation hosting the game — PICK
              THE ONE THAT MATCHES YOUR SETUP AND DELETE THE OTHER].
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Children</h2>
            <p className="mt-2 leading-relaxed">
              This software is deliberately built so that <em>playing</em> a quiz
              involves no personal data, which is why a class of children can
              play without anyone processing their information. Accounts are a
              different matter: <strong>you must be [16 / the digital age of
              consent in your country] or older to create one.</strong> If you
              operate this in a school, read <code>docs/LEGAL.md</code> — you may
              need a data processing agreement with the school and, in some
              countries, verified parental consent.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">How long we keep it</h2>
            <ul className="mt-3 space-y-1.5 pl-5">
              <li className="list-disc">
                Game records, including nicknames and answers: [RETENTION PERIOD
                — e.g. 90 days], then deleted.
              </li>
              <li className="list-disc">
                Account data and your quizzes: until you delete your account.
              </li>
              <li className="list-disc">
                Expired sign-in sessions: removed automatically.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Who else sees it</h2>
            <p className="mt-2 leading-relaxed">
              We do not sell your data or share it for advertising. Data is
              shared only with the infrastructure providers needed to run the
              service: [HOSTING PROVIDER], [DATABASE PROVIDER].
            </p>
            <p className="mt-3 leading-relaxed">
              <strong>If AI question generation is enabled on this server</strong>
              , the topic and any source text you submit are sent to Anthropic
              to generate questions. Do not paste confidential material or other
              people&apos;s personal data into that field. Quiz players&apos;
              data is never sent to any AI service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Your rights</h2>
            <p className="mt-2 leading-relaxed">
              If you are in the UK or EU you can ask for a copy of your data, ask
              us to correct or delete it, object to processing, or ask for it in
              a portable format. Account holders can delete everything
              immediately from the Settings page. For anything else, contact{" "}
              <strong>[CONTACT EMAIL]</strong>. You also have the right to
              complain to your data protection authority — in the UK that is the
              ICO (ico.org.uk).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Where your data is</h2>
            <p className="mt-2 leading-relaxed">
              Data is stored in [REGION/COUNTRY]. [If you transfer data outside
              the UK/EEA, name the safeguard you rely on — for example Standard
              Contractual Clauses or an adequacy decision.]
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
