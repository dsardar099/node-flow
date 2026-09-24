import { JsonLd, faqGraph, type FaqItem } from './json-ld';

/**
 * Questions and answers, rendered as readable text *and* as `FAQPage`
 * structured data from the same array.
 *
 * One source for both is the point: structured data that says something the
 * page does not is how a site loses rich results, and two copies of an answer
 * drift. Plain headings and paragraphs rather than an accordion, so every
 * answer is in the HTML a crawler reads without running a click handler.
 */
export function FAQ({
  items,
  title = 'Frequently asked questions',
}: {
  items: FaqItem[];
  title?: string;
}) {
  return (
    <section aria-labelledby="faq">
      <JsonLd data={faqGraph(items)} />
      <h2 id="faq">{title}</h2>
      {items.map(({ question, answer }) => (
        <div key={question}>
          <h3>{question}</h3>
          <p>{answer}</p>
        </div>
      ))}
    </section>
  );
}
