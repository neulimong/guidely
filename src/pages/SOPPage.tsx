import React, { useState } from 'react';
import { FileText, Send, Loader2, Copy, CheckCircle, BookOpen } from 'lucide-react';
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

const SOPPage = () => {
  const [taskName, setTaskName] = useState('');
  const [submittedTaskName, setSubmittedTaskName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sopContent, setSopContent] = useState('');
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [error, setError] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const { toast } = useToast();

  const getQueryEmbedding = async (text: string): Promise<number[]> => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API 키가 설정되지 않았습니다.');
    
    const modelName = "models/gemini-embedding-2";
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:embedContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        content: { parts: [{ text }] }
      })
    });
    
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.');
      }
      if (response.status === 503) {
        throw new Error('AI 서버가 현재 혼잡합니다. 잠시 후 다시 시도해주세요 (503).');
      }
      throw new Error(`임베딩 오류: ${response.statusText}`);
    }
    
    const data = await response.json();
    if (data.embedding && data.embedding.values) {
      return data.embedding.values;
    }
    throw new Error('임베딩 결과를 반환받지 못했습니다.');
  };

  const generateSop = async (prompt: string): Promise<string> => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    
    const modelName = "models/gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.');
      }
      if (response.status === 503) {
        throw new Error('AI 서버가 현재 혼잡합니다. 잠시 후 다시 시도해주세요 (503).');
      }
      throw new Error(`SOP 생성 오류: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'SOP를 생성할 수 없습니다.';
  };

  const handleGenerate = async () => {
    if (!taskName.trim() || isLoading) return;
    
    setIsLoading(true);
    setError('');
    setSopContent('');
    setSources([]);
    setIsCopied(false);
    setSubmittedTaskName(taskName);

    try {
      // 1. Get embedding for the task name
      const queryEmbedding = await getQueryEmbedding(taskName);

      // 2. Search Supabase for similar chunks
      const { data: chunks, error: rpcError } = await supabase.rpc('match_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: 0.5,
        match_count: 5
      });

      if (rpcError) {
        throw new Error(`문서 검색 오류: ${rpcError.message}`);
      }

      let contextString = '';
      if (chunks && chunks.length > 0) {
        const uniqueSourcesMap = new Map<string, SourceDoc>();
        const contextTexts = chunks.map((chunk: any, index: number) => {
          if (!uniqueSourcesMap.has(chunk.document_name)) {
            uniqueSourcesMap.set(chunk.document_name, {
              id: chunk.document_id || index.toString(),
              document_name: chunk.document_name,
              similarity: chunk.similarity
            });
          }
          return `[문서명: ${chunk.document_name}]\n${chunk.content}`;
        });
        
        setSources(Array.from(uniqueSourcesMap.values()));
        contextString = contextTexts.join('\n\n---\n\n');
      } else {
        contextString = "관련된 참고 문서를 찾지 못했습니다. 일반적인 기준으로 작성해주세요.";
      }

      const prompt = `당신은 기업 운영 전문가입니다.
아래 [참고 문서]를 바탕으로 [업무명]에 대한 SOP를 작성하세요.
반드시 다음 6개 항목 순서대로 작성하세요:
1. 업무 목적
2. 적용 대상
3. 사전 준비물
4. 단계별 절차 (번호 매기기)
5. 주의사항
6. 완료 체크리스트 (반드시 '- [ ] 할일' 형식의 마크다운 체크박스로 작성)

[참고 문서]
${contextString}

[업무명]
${taskName}

SOP 내용:`;
      
      const generatedText = await generateSop(prompt);
      setSopContent(generatedText);

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'SOP 생성 중 오류가 발생했습니다.');
      toast('잠시 후 다시 시도해주세요', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (sopContent) {
      navigator.clipboard.writeText(sopContent);
      setIsCopied(true);
      toast('클립보드에 복사됐어요', 'success');
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleGenerate();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#F8F9FA] relative">
      <div className="flex-1 overflow-y-auto p-8 pb-32">
        <div className="max-w-4xl mx-auto space-y-8">
          
          {/* Header */}
          <div className="text-center mt-8 mb-12 p-10 bg-gradient-to-br from-indigo-50 via-purple-50 to-transparent rounded-3xl border border-white shadow-sm">
            <div className="inline-flex items-center justify-center p-4 bg-white rounded-2xl mb-6 shadow-sm">
              <BookOpen className="w-12 h-12 text-indigo-600" />
            </div>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">SOP 자동 생성</h1>
            <p className="text-gray-500 mt-4 text-lg">업무명을 입력하면 회사 규정과 매뉴얼을 바탕으로 표준작업절차서(SOP)를 작성합니다.</p>
          </div>

          {/* Input Area */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
            <label className="block text-sm font-medium text-gray-700 mb-2">어떤 업무의 SOP가 필요하신가요?</label>
            <div className="relative flex items-center">
              <input
                type="text"
                className="block w-full pl-4 pr-24 py-4 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 text-lg"
                placeholder="예: 신규 입사자 PC 세팅, 법인카드 정산 등"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={isLoading}
              />
              <button
                onClick={handleGenerate}
                disabled={isLoading || !taskName.trim()}
                className="absolute right-2 flex items-center justify-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors duration-200"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 mr-1" />}
                {!isLoading && <span>생성</span>}
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && <ErrorCard message={error} onRetry={handleGenerate} />}

          {/* SOP Result Card */}
          {!isLoading && sopContent && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition-all duration-300">
              <div className="bg-indigo-50/50 border-b border-gray-100 p-4 flex items-center justify-between">
                <div className="flex items-center">
                  <FileText className="w-5 h-5 text-indigo-600 mr-2" />
                  <h2 className="font-semibold text-gray-900 text-lg">SOP: {submittedTaskName}</h2>
                </div>
                <button
                  onClick={handleCopy}
                  className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:border-indigo-300 shadow-sm"
                >
                  {isCopied ? (
                    <><CheckCircle className="w-4 h-4 mr-1.5 text-green-500" /> 복사됨</>
                  ) : (
                    <><Copy className="w-4 h-4 mr-1.5" /> 내용 복사</>
                  )}
                </button>
              </div>
              
              <div className="p-8">
                <div className="prose prose-indigo max-w-none text-gray-800 leading-relaxed prose-headings:font-bold prose-headings:text-gray-900 prose-h1:text-3xl prose-h1:border-b prose-h1:border-gray-200 prose-h1:pb-2 prose-h1:mb-5 prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-6 prose-h3:mb-3 prose-p:my-3 prose-ul:list-disc prose-ul:pl-6 prose-ul:my-3 prose-li:my-1.5 prose-strong:font-bold prose-strong:text-gray-900 prose-blockquote:border-l-4 prose-blockquote:border-indigo-300 prose-blockquote:bg-indigo-50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={{
                      input: ({node, checked, disabled, ...props}) => {
                        if (props.type === 'checkbox') {
                          return <input type="checkbox" defaultChecked={checked} className="form-checkbox h-4 w-4 text-indigo-600 rounded border-gray-300 cursor-pointer inline-block align-middle mr-2" {...props} />;
                        }
                        return <input checked={checked} disabled={disabled} {...props} />;
                      }
                    }}
                  >
                    {sopContent}
                  </ReactMarkdown>
                </div>
              </div>
              
              {sources.length > 0 && (
                <div className="bg-gray-50 p-5 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">SOP 작성에 참고된 문서</p>
                  <div className="flex flex-wrap gap-2">
                    {sources.map((source, idx) => (
                      <div key={idx} className="inline-flex items-center bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 shadow-sm">
                        <FileText className="w-4 h-4 text-indigo-500 mr-2" />
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

export default SOPPage;
