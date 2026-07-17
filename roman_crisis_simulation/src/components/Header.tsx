
import React from 'react';
import { WorldState } from '../types';

const AquilaIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className="h-20 w-20 mx-auto text-red-900 -mb-2" fill="currentColor">
        <path d="M50 10C30 10 15 25 15 45c0 10 5 20 12 26-3-5-5-11-5-17 0-15 12-27 27-27s27 12 27 27c0 6-2 12-5 17 7-6 12-16 12-26 0-20-15-35-35-35zm0 2c18 0 33 14 33 33 0 9-4 18-10 24-2-2-4-4-6-5-2-2-5-3-8-3-10 0-18 8-18 18h-2c0-10-8-18-18-18-3 0-6 1-8 3-2 1-4 3-6 5-6-6-10-15-10-24 0-19 15-33 33-33zm-1 30c-12 0-22 10-22 22 0 4 1 8 3 11 3-2 6-3 10-3 11 0 20 9 20 20v1h-2c-11 0-20-9-20-20 0-5 2-10 6-13-1-3-2-6-2-9 0-10 8-18 18-18s18 8 18 18c0 3-1 6-2 9 4 3 6 8 6 13 0 11-9 20-20 20h-2v-1c0-11 9-20 20-20 4 0 7 1 10 3 2-3 3-7 3-11 0-12-10-22-22-22zM50 78c-8 0-15-7-15-15s7-15 15-15 15 7 15 15-7 15-15 15z" />
    </svg>
);


const Header: React.FC<{ worldState: WorldState, isMockMode: boolean, setIsMockMode: (isMock: boolean) => void }> = ({ worldState, isMockMode, setIsMockMode }) => (
    <header className="relative text-center p-3 bg-[#e8e6e1]/70 backdrop-blur-sm border-b-4 border-double border-[#c9c5b8]">
        {import.meta.env.DEV && (
            <div className="absolute top-2 right-2 flex items-center bg-stone-700 p-2 rounded text-stone-100 font-mono text-xs shadow-lg z-10">
              <label htmlFor="mock-toggle" className="mr-2 cursor-pointer">Mock Mode</label>
              <input
                id="mock-toggle"
                type="checkbox"
                checked={isMockMode}
                onChange={(e) => setIsMockMode(e.target.checked)}
                className="h-4 w-4 text-red-800 bg-stone-600 border-stone-500 rounded focus:ring-red-700 cursor-pointer"
              />
            </div>
        )}
        <AquilaIcon />
        <h1 className="text-4xl font-decorative font-bold text-red-900 roman-inset-text">Roman Crisis Simulation</h1>
        <div className="flex justify-center divide-x-2 divide-stone-400 mt-2 text-md text-stone-700">
            <span className="px-4"><strong>Year:</strong> {worldState.year} CE</span>
            <span className="px-4"><strong>Week:</strong> {worldState.week}</span>
            <span className="px-4"><strong>Economic Stability:</strong> {worldState.economic_stability}</span>
            <span className="px-4"><strong>Political Climate:</strong> {worldState.political_climate}</span>
        </div>
    </header>
);

export default Header;