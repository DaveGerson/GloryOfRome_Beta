import React from 'react';

const GlossaryTooltip: React.FC<{
  children: React.ReactNode;
  description: string;
  wikiLink: string;
}> = ({ children, description, wikiLink }) => (
  <span className="relative group inline-block">
    <span className="border-b border-dotted border-stone-500 cursor-help">{children}</span>
    <div className="tooltip-bubble text-left !w-64"> {/* Wider for more text */}
      <p>{description}</p>
      <a
        href={wikiLink}
        target="_blank"
        rel="noopener noreferrer"
        className="text-amber-300 hover:text-amber-200 mt-2 block font-bold text-xs"
      >
        Read more on Wikipedia &rarr;
      </a>
    </div>
  </span>
);

export default GlossaryTooltip;
