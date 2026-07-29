import React from 'react';

/**
 * Core primitives from the Glory of Rome design system
 * (claude.ai/design project "Glory of Rome Design System" — components/core).
 * Styling lives in design/components.css (`gor-*` classes).
 */

type ButtonProps = {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
} & Omit<React.ComponentPropsWithoutRef<'button'>, 'className'>;

export const Button: React.FC<ButtonProps> = ({ variant = 'primary', size = 'md', children, ...rest }) => (
    <button className={`gor-btn gor-btn-${size} gor-btn-${variant}`} {...rest}>{children}</button>
);

type CardProps = {
    title?: React.ReactNode;
    action?: React.ReactNode;
    gilt?: boolean;
    className?: string;
} & Omit<React.ComponentPropsWithoutRef<'section'>, 'title'>;

export const Card: React.FC<CardProps> = ({ title, action, gilt, children, className = '', ...rest }) => (
    <section className={`gor-card ${gilt ? 'gor-card-gilt' : ''} ${className}`} {...rest}>
        {title && <header className="gor-card-head"><span className="gor-card-title">{title}</span>{action}</header>}
        <div className="gor-card-body">{children}</div>
    </section>
);

type BadgeProps = {
    tone?: 'gold' | 'crimson' | 'tyrian' | 'laurel' | 'bronze' | 'neutral';
} & React.ComponentPropsWithoutRef<'span'>;

export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', children, ...rest }) => (
    <span className={`gor-badge gor-badge-${tone}`} {...rest}>{children}</span>
);

export const Divider: React.FC<Omit<React.ComponentPropsWithoutRef<'hr'>, 'className'>> = (props) => <hr className="gor-divider" {...props} />;

type RegisterHeadingProps = {
    /** A ceremonial numeral, where the registers are ordered (the dispatch scroll). */
    numeral?: string;
    /** Set when a `<section aria-labelledby>` points at this heading. */
    headingId?: string;
    title: React.ReactNode;
    /** Sits past the rule — a badge, a count. */
    trailing?: React.ReactNode;
};

/**
 * A hairline-ruled register heading: an optional numeral, a crimson label,
 * then a rule fading out to the edge.
 *
 * The alternative to a gilt card. The design system allows **at most one gilt
 * card per view** — gold corner brackets stop meaning anything when five of
 * them share a scroll — so anything that is merely an option lives under one
 * of these instead (audit items 02 and 32).
 *
 * The numeral and the rule are decorative; only the `<h3>` carries the id, so
 * a labelled section's accessible name stays the heading's own words.
 */
export const RegisterHeading: React.FC<RegisterHeadingProps> = ({ numeral, headingId, title, trailing }) => (
    <div className="gor-register-head">
        {numeral && <span className="gor-register-numeral" aria-hidden="true">{numeral}</span>}
        <h3 id={headingId} className="gor-label gor-register-title">{title}</h3>
        <span className="gor-register-rule" aria-hidden="true" />
        {trailing}
    </div>
);
