import { useState } from 'react';
import { MessageSquare, Send, Loader2, Copy, CheckCircle, FileText } from 'lucide-react';
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

const CSPage = () => {
  const [inquiry, setInquiry] = useState('');
  const [tone, setTone] = useState('공손한 어조');
  const [isLoading, setIsLoading] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [error, setError] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const { toast } = useToast();

  const tones = ['공손한 어조', '친근한 어조', '공식적인 어조'];

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

  const generateDraft = async (prompt: string): Promise<string> => {
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
      throw new Error('답변 생성 API 오류');
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  };

  const handleGenerate = async () => {
    if (!inquiry.trim() || isLoading) return;
    setIsLoading(true); setError(''); setDraftContent(''); setSources([]); setIsCopied(false);

    try {
      const queryEmbedding = await getQueryEmbedding(inquiry);
      const { data: chunks, error: rpcError } = await supabase.rpc('match_chunks', {
        query_embedding: queryEmbedding, match_threshold: 0.5, match_count: 5
      });
      if (rpcError) throw new Error(rpcError.message);

      let contextString = '관련 문서를 찾지 못했습니다.';
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

      const prompt = `당신은 기업 운영 전문가입니다. 아래 회사 정책 문서를 참고하여 직원 문의에 대한 답변 초안을 ${tone}로 작성하세요.
참고 문서에 관련 내용이 없다면, 절대 내용을 지어내거나 일반적인 조언을 하지 마세요.
대신 '해당 내용은 현재 등록된 사내 문서에서 확인되지 않습니다. 담당 부서에 직접 문의해 주세요.'라고만 답변하세요.

[문서]
${contextString}

[직원 문의]
${inquiry}

답변 초안:`;
      const result = await generateDraft(prompt);
      setDraftContent(result);
    } catch (err: any) {
      setError(err.message || '오류 발생');
      toast('잠시 후 다시 시도해주세요', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (draftContent) {
      navigator.clipboard.writeText(draftContent);
      setIsCopied(true);
      toast('클립보드에 복사됐어요', 'success');
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#F8F9FA] relative">
      <div className="flex-1 overflow-y-auto p-8 pb-32">
        <div className="max-w-4xl mx-auto space-y-8">
          
          <div className="text-center mt-8 mb-12 p-10 bg-gradient-to-br from-orange-50 via-red-50 to-transparent rounded-3xl border border-white shadow-sm">
            <div className="inline-flex items-center justify-center p-4 bg-white rounded-2xl mb-6 shadow-sm">
              <MessageSquare className="w-12 h-12 text-orange-600" />
            </div>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">사내 문의 답변 초안</h1>
            <p className="text-gray-500 mt-4 text-lg">부서 간 문의나 직원 요청에 대해 회사 규정 기반의 답변 초안을 작성합니다.</p>
          </div>

          <div className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm">
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">어떤 어조로 답변을 작성할까요?</label>
              <div className="flex flex-wrap gap-3">
                {tones.map(t => (
                  <button
                    key={t}
                    onClick={() => setTone(t)}
                    className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                      tone === t 
                        ? 'bg-orange-100 text-orange-800 border-2 border-orange-300 shadow-sm' 
                        : 'bg-white text-gray-600 border-2 border-gray-100 hover:border-orange-200 hover:bg-orange-50'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-2">
              <label className="block text-sm font-semibold text-gray-700 mb-3">직원 문의 내용</label>
              <div className="relative">
                <textarea
                  className="block w-full p-5 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200 text-base min-h-[140px] resize-y"
                  placeholder="예: 비품 신청은 어떻게 하나요? 출장비 처리 절차를 알고 싶어요."
                  value={inquiry}
                  onChange={(e) => setInquiry(e.target.value)}
                  disabled={isLoading}
                />
                <div className="absolute bottom-4 right-4">
                  <button
                    onClick={handleGenerate}
                    disabled={isLoading || !inquiry.trim()}
                    className="flex items-center justify-center px-6 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors duration-200 font-medium shadow-sm"
                  >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 mr-2" />}
                    {!isLoading && <span>답변 생성</span>}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error && <ErrorCard message={error} onRetry={handleGenerate} />}

          {!isLoading && draftContent && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition-all duration-300">
              <div className="bg-orange-50/50 border-b border-gray-100 p-5 flex items-center justify-between">
                <div className="flex items-center">
                  <MessageSquare className="w-5 h-5 text-orange-600 mr-2.5" />
                  <h2 className="font-bold text-gray-900 text-lg">AI 답변 초안 <span className="text-sm font-normal text-gray-500 ml-2">({tone})</span></h2>
                </div>
                <button
                  onClick={handleCopy}
                  className="flex items-center text-sm font-medium text-gray-600 hover:text-orange-600 transition-colors bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:border-orange-300 shadow-sm"
                >
                  {isCopied ? (
                    <><CheckCircle className="w-4 h-4 mr-1.5 text-green-500" /> 복사됨</>
                  ) : (
                    <><Copy className="w-4 h-4 mr-1.5" /> 내용 복사</>
                  )}
                </button>
              </div>
              
              <div className="p-8">
                <div className="prose prose-orange max-w-none text-gray-800 leading-relaxed prose-headings:font-bold prose-headings:text-gray-900 prose-h1:text-3xl prose-h1:border-b prose-h1:border-gray-200 prose-h1:pb-2 prose-h1:mb-5 prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-6 prose-h3:mb-3 prose-p:my-3 prose-ul:list-disc prose-ul:pl-6 prose-ul:my-3 prose-li:my-1.5 prose-strong:font-bold prose-strong:text-gray-900 prose-blockquote:border-l-4 prose-blockquote:border-orange-300 prose-blockquote:bg-orange-50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={{
                      input: ({node, checked, disabled, ...props}) => {
                        if (props.type === 'checkbox') {
                          return <input type="checkbox" defaultChecked={checked} className="form-checkbox h-4 w-4 text-orange-600 rounded border-gray-300 cursor-pointer inline-block align-middle mr-2" {...props} />;
                        }
                        return <input checked={checked} disabled={disabled} {...props} />;
                      }
                    }}
                  >
                    {draftContent}
                  </ReactMarkdown>
                </div>
              </div>
              
              {sources.length > 0 && (
                <div className="bg-gray-50 p-5 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">참고한 회사 정책 문서</p>
                  <div className="flex flex-wrap gap-2">
                    {sources.map((source, idx) => (
                      <div key={idx} className="inline-flex items-center bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 shadow-sm">
                        <FileText className="w-4 h-4 text-orange-500 mr-2" />
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

export default CSPage;
