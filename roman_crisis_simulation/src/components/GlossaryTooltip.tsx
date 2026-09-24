import React from 'react';

/**
 * Dotted-underline term that opens a gloss with an optional "Read more" link —
 * the design system's GlossaryTerm. Click-to-open (touch- and keyboard-friendly),
 * closes on outside press.
 */
const GlossaryTooltip: React.FC<{
    children: React.ReactNode;
    description: string;
    wikiLink: string;
}> = ({ children, description, wikiLink }) => {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLSpanElement>(null);
    React.useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);
    return (
        <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
            <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); } }} style={{ all: 'unset', cursor: 'help', borderBottom: '1px dotted var(--gold-600)', font: 'inherit', color: 'inherit' }}>{children}</button>
            {open && (
                <span style={{ position: 'absolute', bottom: 'calc(100% + 9px)', left: 0, zIndex: 60, width: 250, display: 'block', background: 'var(--ink-800)', border: '1px solid var(--border-subtle)', color: '#F4ECD8', fontFamily: 'var(--font-body)', fontSize: 14, fontStyle: 'normal', fontWeight: 400, letterSpacing: 0, textTransform: 'none', lineHeight: 1.45, padding: '10px 12px', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-raised)' }}>
                    {description}
                    {wikiLink && <a href={wikiLink} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 6, color: 'var(--gold-300)', borderBottom: '1px solid rgba(227,199,102,.4)' }}>Read more ›</a>}
                </span>
            )}
        </span>
    );
};

export default GlossaryTooltip;
