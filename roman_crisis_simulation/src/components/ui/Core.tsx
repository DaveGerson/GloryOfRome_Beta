import React from 'react';

/**
 * Core primitives from the Glory of Rome design system
 * (claude.ai/design project "Glory of Rome Design System" — components/core).
 * Styling lives in design/components.css (`gor-*` classes).
 */

export const Button: React.FC<{
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    [key: string]: any;
}> = ({ variant = 'primary', size = 'md', children, ...rest }) => (
    <button className={`gor-btn gor-btn-${size} gor-btn-${variant}`} {...rest}>{children}</button>
);

export const Card: React.FC<{
    title?: React.ReactNode;
    action?: React.ReactNode;
    gilt?: boolean;
    className?: string;
    [key: string]: any;
}> = ({ title, action, gilt, children, className = '', ...rest }) => (
    <section className={`gor-card ${gilt ? 'gor-card-gilt' : ''} ${className}`} {...rest}>
        {title && <header className="gor-card-head"><span className="gor-card-title">{title}</span>{action}</header>}
        <div className="gor-card-body">{children}</div>
    </section>
);

export const Badge: React.FC<{
    tone?: 'gold' | 'crimson' | 'tyrian' | 'laurel' | 'bronze' | 'neutral';
    [key: string]: any;
}> = ({ tone = 'neutral', children, ...rest }) => (
    <span className={`gor-badge gor-badge-${tone}`} {...rest}>{children}</span>
);

export const Divider: React.FC<{ [key: string]: any }> = (props) => <hr className="gor-divider" {...props} />;
