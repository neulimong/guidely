import { useState } from 'react';
import { FileText, Send, Loader2, CheckCircle, ListChecks, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/ui/ToastContext';
import ErrorCard from '../components/ui/ErrorCard';

interface SourceDoc {
  id: string;
  document_name: string;
  similarity: number;
}

const ChecklistPage = () => {
  const [scenario, setScenario] = useState('');
  const [submittedScenario, setSubmittedScenario] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [content, setContent] = useState('');
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [error, setError] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const { toast } = useToast();

  const getQueryEmbedding = async (text: string): Promise<number[]> => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    const modelName = "models/gemini-embedding-2";
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:embedContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, content: { parts: [{ text }] } })
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error('API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.');
      if (response.status === 503) throw new Error('AI 서버가 현재 혼잡합니다. 잠시 후 다시 시도해주세요 (503).');
      throw new Error('임베딩 API 오류');
    }
    const data = await response.json();
    return data.embedding.values;
  };

  const generateChecklist = async (prompt: string): Promise<string> => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    const modelName = "models/gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error('API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.');
      if (response.status === 503) throw new Error('AI 서버가 현재 혼잡합니다. 잠시 후 다시 시도해주세요 (503).');
      throw new Error('체크리스트 생성 API 오류');
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  };

  const handleGenerate = async () => {
    if (!scenario.trim() || isLoading) return;
    setIsLoading(true);
    setError('');
    setContent('');
    setSources([]);
    setSubmittedScenario(scenario);
    try {
      const queryEmbedding = await getQueryEmbedding(scenario);
      const { data: chunks, error: rpcError } = await supabase.rpc('match_chunks', {
        query_embedding: queryEmbedding, match_threshold: 0.5, match_count: 5
      });
      if (rpcError) throw new Error(rpcError.message);

      let contextString = '관련 문서를 찾지 못했습니다. 일반적인 기준으로 작성해 주세요.';
      if (chunks && chunks.length > 0) {
        const uniqueSourcesMap = new Map<string, SourceDoc>();
        const contextTexts = chunks.map((chunk: any, index: number) => {
          if (!uniqueSourcesMap.has(chunk.document_name)) {
            uniqueSourcesMap.set(chunk.document_name, { id: chunk.document_id || index.toString(), document_name: chunk.document_name, similarity: chunk.similarity });
          }
          return `[${chunk.document_name}]\n${chunk.content}`;
        });
        setSources(Array.from(uniqueSourcesMap.values()));
        contextString = contextTexts.join('\n\n---\n\n');
      }

      const prompt = `아래 문서를 참고하여 [상황]에 대한 체크리스트를 작성하세요. 반드시 '- [ ] 할일' 형식의 마크다운 체크박스 리스트로 만들어주세요.\n\n[문서]\n${contextString}\n\n[상황]\n${scenario}\n\n체크리스트:`;
      const result = await generateChecklist(prompt);
      setContent(result);
    } catch (err: any) {
      setError(err.message || '오류 발생');
      toast('잠시 후 다시 시도해주세요', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setIsCopied(true);
      toast('체크리스트 내용이 클립보드에 복사되었습니다.', 'success');
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      toast('복사에 실패했습니다.', 'error');
    }
  };

  const handleToggle = (index: number) => {
    let curr = 0;
    const newContent = content.replace(/- \[[ xX]\]/g, match => {
      if (curr === index) {
        curr++;
        return match.toLowerCase() === '- [x]' ? '- [ ]' : '- [x]';
      }
      curr++;
      return match;
    });
    setContent(newContent);
  };

  const renderContent = () => {
    const blocks: { type: 'markdown' | 'checklist', content: string, index?: number }[] = [];
    let currentMarkdown = '';
    let checkIndex = 0;

    content.split('\n').forEach(line => {
      if (line.match(/^\s*- \[[ xX]\]/)) {
        if (currentMarkdown) {
          blocks.push({ type: 'markdown', content: currentMarkdown });
          currentMarkdown = '';
        }
        blocks.push({ type: 'checklist', content: line, index: checkIndex++ });
      } else {
        currentMarkdown += line + '\n';
      }
    });
    if (currentMarkdown) blocks.push({ type: 'markdown', content: currentMarkdown });

    return blocks.map((block, i) => {
      if (block.type === 'markdown') {
        return (
          <div key={i} className="prose prose-teal max-w-none text-gray-800 leading-relaxed my-4 prose-headings:font-bold prose-headings:text-gray-900 prose-h1:text-3xl prose-h1:border-b prose-h1:border-gray-200 prose-h1:pb-2 prose-h1:mb-5 prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-6 prose-h3:mb-3 prose-p:my-3 prose-ul:list-disc prose-ul:pl-6 prose-ul:my-3 prose-li:my-1.5 prose-strong:font-bold prose-strong:text-gray-900 prose-blockquote:border-l-4 prose-blockquote:border-teal-300 prose-blockquote:bg-teal-50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
              {block.content}
            </ReactMarkdown>
          </div>
        );
      } else {
        const isChecked = !!block.content.match(/- \[[xX]\]/);
        const text = block.content.replace(/^\s*- \[[ xX]\]\s*/, '').trim();
        return (
          <div 
            key={i} 
            onClick={() => handleToggle(block.index!)} 
            className={`flex items-start my-2 cursor-pointer p-4 rounded-xl border transition-all duration-200 shadow-sm ${isChecked ? 'bg-gray-50 border-gray-200' : 'bg-white border-teal-100 hover:border-teal-300 hover:shadow-md'}`}
          >
            <div className={`mt-0.5 mr-4 w-6 h-6 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isChecked ? 'bg-teal-500 border-teal-500 text-white' : 'border-gray-300 bg-white'}`}>
              {isChecked && <CheckCircle className="w-4 h-4" />}
            </div>
            <span className={`text-gray-800 font-medium ${isChecked ? 'line-through text-gray-400' : ''}`}>{text}</span>
          </div>
        );
      }
    });
  };

  const totalChecks = (content.match(/- \[[ xX]\]/g) || []).length;
  const completedChecks = (content.match(/- \[[xX]\]/g) || []).length;
  const progress = totalChecks === 0 ? 0 : Math.round((completedChecks / totalChecks) * 100);

  return (
    <div className="flex flex-col h-full bg-[#F8F9FA] relative">
      <div className="flex-1 overflow-y-auto p-8 pb-32">
        <div className="max-w-4xl mx-auto space-y-8">
          
          <div className="text-center mt-8 mb-12 p-10 bg-gradient-to-br from-teal-50 via-blue-50 to-transparent rounded-3xl border border-white shadow-sm">
            <div className="inline-flex items-center justify-center p-4 bg-white rounded-2xl mb-6 shadow-sm">
              <ListChecks className="w-12 h-12 text-teal-600" />
            </div>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">상황별 체크리스트</h1>
            <p className="text-gray-500 mt-4 text-lg">상황을 입력하면 관련 문서 기반의 맞춤형 체크리스트를 생성합니다.</p>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
            <label className="block text-sm font-medium text-gray-700 mb-3">어떤 상황의 체크리스트가 필요하신가요?</label>
            <div className="relative flex items-center">
              <input
                type="text"
                className="block w-full pl-5 pr-24 py-4 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all duration-200 text-lg"
                placeholder="예: 신입사원 첫 출근, 연말 정산, 워크샵 준비 등"
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                disabled={isLoading}
              />
              <button
                onClick={handleGenerate}
                disabled={isLoading || !scenario.trim()}
                className="absolute right-2 flex items-center justify-center px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors duration-200 font-medium"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 mr-1.5" />}
                {!isLoading && <span>생성</span>}
              </button>
            </div>
          </div>

          {error && <ErrorCard message={error} onRetry={handleGenerate} />}

          {!isLoading && content && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition-all duration-300">
              <div className="bg-teal-50/50 p-6 border-b border-gray-100">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center">
                    <ListChecks className="w-6 h-6 text-teal-600 mr-2" />
                    <h2 className="font-semibold text-gray-900 text-lg">체크리스트: {submittedScenario}</h2>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-teal-700 font-bold bg-white px-3 py-1 rounded-full text-sm border border-teal-200 shadow-sm">
                      {completedChecks} / {totalChecks} 완료
                    </span>
                    <button
                      onClick={handleCopy}
                      className="flex items-center px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-teal-600 transition-colors shadow-sm"
                    >
                      {isCopied ? <CheckCircle className="w-4 h-4 mr-1.5 text-teal-500" /> : <Copy className="w-4 h-4 mr-1.5" />}
                      {isCopied ? '복사 완료' : '내용 복사'}
                    </button>
                  </div>
                </div>
                <div className="w-full bg-teal-100/50 rounded-full h-3 overflow-hidden border border-teal-100">
                  <div 
                    className="bg-teal-500 h-3 rounded-full transition-all duration-500 ease-out" 
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>
              
              <div className="p-8">
                {renderContent()}
              </div>
              
              {sources.length > 0 && (
                <div className="bg-gray-50 p-5 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">참고 문서</p>
                  <div className="flex flex-wrap gap-2">
                    {sources.map((source, idx) => (
                      <div key={idx} className="inline-flex items-center bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 shadow-sm">
                        <FileText className="w-4 h-4 text-teal-500 mr-2" />
                        {source.document_name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChecklistPage;
