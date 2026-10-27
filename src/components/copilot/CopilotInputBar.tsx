import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Square,
  Mic,
  MicOff,
  Paperclip,
} from 'lucide-react';
import { Button } from '../common/Button';

interface CopilotInputBarProps {
  onSendMessage: (text: string) => void;
  isStreaming: boolean;
  onStopStreaming: () => void;
}

export const CopilotInputBar: React.FC<CopilotInputBarProps> = ({
  onSendMessage,
  isStreaming,
  onStopStreaming,
}) => {
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef<any>(null);

  // Initialize Speech Recognition if supported
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setVoiceTranscript(transcript);
        setInputText((prev) => (prev ? `${prev} ${transcript.trim()}` : transcript.trim()));
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    } catch {
      setSpeechSupported(false);
    }
  }, []);

  const toggleListening = () => {
    if (!speechSupported || !recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setVoiceTranscript('');
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.warn('Failed to start speech recognition:', err);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!inputText.trim() || isStreaming) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  return (
    <div className="w-full bg-white px-4 pb-4 pt-2 shrink-0">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-2 shadow-xs">
        {/* Single Seamless Input Box Matching Screenshot */}
        <div className="flex items-center gap-2 transition-all">
          {/* File Attachment Icon */}
          <button
            type="button"
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            title="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          {/* Text Input */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Store Copilot about queues, inventory, staff, cameras, or assign tasks..."
            className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3 text-body text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
          />

          {/* Voice Input Toggle Button */}
          {speechSupported && (
            <button
              type="button"
              onClick={toggleListening}
              className={`h-11 w-11 flex items-center justify-center rounded-xl border border-slate-200 transition-colors cursor-pointer ${
                isListening
                  ? 'bg-red-50 text-red-600'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`}
              title={isListening ? 'Stop listening' : 'Voice input'}
            >
              {isListening ? (
                <MicOff className="h-4 w-4 text-red-600 animate-pulse" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>
          )}

          {/* Send Button */}
          {isStreaming ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onStopStreaming}
              className="h-8 text-xs font-semibold border-rose-300 text-rose-600 hover:bg-rose-50 gap-1.5 cursor-pointer rounded-xl"
            >
              <Square className="h-3 w-3 fill-rose-600" />
              <span>Stop</span>
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!inputText.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-3 sm:px-5 h-11 text-sm font-semibold flex items-center gap-2 shadow-xs disabled:opacity-40 cursor-pointer shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Send</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
