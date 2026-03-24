import React from 'react';
import { GameEvent, PlayerEventChoice } from '../types';

const EventModal: React.FC<{
    event: GameEvent;
    onChoose: (choice: PlayerEventChoice) => void;
}> = ({ event, onChoose }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 animate-fade-in">
            <div className="w-full max-w-2xl bg-[#fdfaf3] rounded-lg shadow-xl flex flex-col p-6 border-4 border-double border-red-900 roman-stone-panel">
                <div className="text-center border-b-2 border-stone-300 pb-4">
                    <h2 className="text-3xl font-decorative text-red-900 roman-inset-text">{event.title}</h2>
                </div>
                
                <div className="my-6 text-stone-700 text-center">
                    <p className="whitespace-pre-wrap">{event.description}</p>
                </div>

                <div className="space-y-4">
                    {event.options.map((option, index) => (
                        <button
                            key={index}
                            onClick={() => onChoose(option)}
                            className="w-full text-left p-4 roman-stone-panel rounded-sm border-2 border-transparent hover:border-red-800 transition-colors duration-300 group btn-animate"
                        >
                            <h4 className="font-bold text-red-900 group-hover:text-red-700 roman-inset-text">{option.text}</h4>
                            <p className="text-sm text-stone-600 mt-1">{option.description}</p>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default EventModal;