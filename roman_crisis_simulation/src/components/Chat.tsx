
import React, { useRef, useEffect } from 'react';
import { Message } from '../types';

export const ChatMessage: React.FC<{ message: Message }> = ({ message }) => {
    const isGM = message.sender === 'gm';
    const isMonologue = message.sender === 'player_monologue';
    const isPlayer = message.sender === 'player';

    let messageClasses = '';
    let justification = 'justify-start';

    if (isGM) {
        messageClasses = 'roman-stone-panel text-stone-800 border-l-4 border-red-800';
        justification = 'justify-start';
    } else if (isPlayer) {
        messageClasses = 'bg-red-900 text-stone-100';
        justification = 'justify-end';
    } else if (isMonologue) {
        messageClasses = 'bg-transparent border-2 border-dashed border-stone-400 text-stone-600 italic';
        justification = 'justify-center w-full max-w-2xl mx-auto';
    }
    
    const textWithBold = message.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    return (
        <div className={`flex ${justification} mb-4 animate-fade-in`}>
            {isMonologue ? (
                <div className="text-center w-full">
                    <div className="text-stone-500 text-sm mb-1 font-decorative">Inner Thoughts</div>
                    <div className={`rounded-lg px-4 py-2 ${messageClasses}`}>
                        <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: textWithBold }} />
                    </div>
                </div>
            ) : (
                <div className={`rounded-lg px-4 py-2 max-w-md ${messageClasses}`}>
                    <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: textWithBold }} />
                </div>
            )}
        </div>
    );
};

export const ChatInput: React.FC<{
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    disabled: boolean;
}> = ({ value, onChange, onSubmit, disabled }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [value]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (value.trim() && !disabled) {
                onSubmit();
            }
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (value.trim() && !disabled) {
            onSubmit();
        }
    };
    
    const placeholderText = disabled ? "Awaiting Game Master..." : "Enter your action... (Shift+Enter for new line)";
    
    return (
        <form onSubmit={handleSubmit} className="p-4">
            <div className="flex items-end">
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    placeholder={placeholderText}
                    className="flex-grow rounded-sm py-2 px-4 border border-[#c9c5b8] bg-white/30 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-800 resize-none max-h-40 shadow-inner"
                    aria-label="Chat input"
                    rows={1}
                />
                <button
                    type="submit"
                    disabled={disabled}
                    className="ml-4 bg-red-800 text-stone-100 rounded-sm px-6 py-2 self-stretch flex items-center justify-center hover:bg-red-700 disabled:bg-stone-400 transition-colors border border-red-900 btn-animate"
                    aria-label="Send message"
                >
                    SEND
                </button>
            </div>
        </form>
    );
};

export const ActionPills: React.FC<{ actions: string[]; onSelectAction: (action: string) => void }> = ({ actions, onSelectAction }) => {
    return (
        <div className="px-4 pt-2 pb-1 flex flex-wrap justify-center animate-fade-in">
            {actions.map((action, index) => (
                <button
                    key={index}
                    onClick={() => onSelectAction(action)}
                    className="bg-stone-300 hover:bg-red-800 hover:text-white transition-colors duration-200 text-stone-700 rounded-sm px-4 py-1.5 text-sm mr-2 mb-2 shadow-md border border-stone-400 btn-animate pill-animate"
                    style={{ animationDelay: `${index * 50}ms` }}
                >
                    {action}
                </button>
            ))}
        </div>
    );
};