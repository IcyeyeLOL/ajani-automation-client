import { FaqItem } from "./faq-item";
import { Reveal } from "./reveal";
import styles from "./delivery-trust.module.css";

const faqGroups = [
  {
    number: "01",
    title: "Getting started",
    items: [
      {
        question: "What do I need to bring to the first conversation?",
        answer:
          "Bring one process that loses time, leads, context, or follow-through. You can write it down, record it in ordinary language, or email Ajani. You do not need to arrive with a workflow diagram or software specification.",
      },
      {
        question: "Does submitting a request cost anything?",
        answer:
          "No. Ajani’s Terms say there is no charge for submitting or approving a public build request. Any fee, deposit, milestone, cancellation term, or refund term must appear in the applicable written Order before payment is requested.",
      },
      {
        question: "How long does a workflow build take?",
        answer:
          "The current request flow shows a 7–10 day target window. It is an estimate, not a universal commitment. The clock begins only after the agreed scope, access, content, payment, decisions, and third-party approvals are in place.",
      },
    ],
  },
  {
    number: "02",
    title: "The build",
    items: [
      {
        question: "Which tools can Ajani work with?",
        answer:
          "The current integration list includes HubSpot, GoHighLevel, monday.com, Gmail, Microsoft Outlook, custom APIs, and webhooks. The exact connection and permissions are confirmed in the project scope.",
      },
      {
        question: "Who owns the finished system?",
        answer:
          "You retain the content and materials you provide. Ajani retains its pre-existing tools, templates, components, processes, and general know-how. Ownership or licensing of project-specific deliverables is defined in the written Order.",
      },
      {
        question: "What happens after launch?",
        answer:
          "Every workflow needs an owner, monitoring, and a fallback. The project Order defines the agreed support and maintenance. Ajani has not yet published a standard training or ongoing-care package, so those details must be confirmed before launch.",
      },
    ],
  },
  {
    number: "03",
    title: "Trust and control",
    items: [
      {
        question: "How does Ajani handle access and data?",
        answer:
          "Access is limited by account and organization, voice uploads use private storage, and client connections require authorization for the agreed workflow. The Privacy Policy and provider inventory explain the current processing and retention paths in detail.",
      },
      {
        question: "What will Ajani not automate?",
        answer:
          "Ajani does not permit automated output to be the sole basis for high-impact decisions about healthcare, employment, housing, education, credit, insurance, legal services, government benefits, or similar rights. Sensitive or regulated data also does not belong in the public intake.",
      },
    ],
  },
] as const;

export function DeliveryTrust() {
  return (
    <div className={styles.root}>
      <section aria-labelledby="faq-title" className={styles.faq} id="faq">
        <div className={styles.faqInner}>
          <Reveal className={styles.faqIntro}>
            <p className={styles.label}>Frequently asked</p>
            <h2 id="faq-title">The practical questions, <em>answered plainly.</em></h2>
          </Reveal>

          <div className={styles.faqGrid}>
            {faqGroups.map((group) => (
              <section aria-labelledby={`faq-group-${group.number}`} className={styles.faqGroup} key={group.number}>
                <header>
                  <span>{group.number} / 03</span>
                  <h3 id={`faq-group-${group.number}`}>{group.title}</h3>
                </header>
                <div className={styles.faqList}>
                  {group.items.map((item, index) => (
                    <FaqItem
                      answer={item.answer}
                      id={`faq-answer-${group.number}-${index}`}
                      key={item.question}
                      question={item.question}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
