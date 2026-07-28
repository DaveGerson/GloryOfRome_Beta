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
