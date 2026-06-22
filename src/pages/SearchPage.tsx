import React, { useState } from 'react';
import { Search, Send, Sparkles, FileText, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/ui/ToastContext';
import ErrorCard from '../components/ui/ErrorCard';
import EmptyState from '../components/ui/EmptyState';

interface SourceDoc {
  id: string;
  document_name: string;
  similarity: number;
}

const SearchPage = () => {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const quickChips = [
    "법인카드 정산 절차",
    "비품 신청 방법",
    "긴급 비품 요청"
  ];

  const handleChipClick = (chip: string) => {
    setQuery(chip);
    handleSearch(chip);
  };

  const getQueryEmbedding = async (text: string): Promise<number[]> => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API 키가 설정되지 않았습니다.');
    
    const modelName = "models/gemini-embedding-2";
    console.log(`[API 호출] 임베딩 변환 모델: ${modelName}`);
    
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:embedContent?key=${apiKey}`;
    
    console.log("API 호출 시작");
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
        const errText = await response.text().catch(() => "응답을 읽을 수 없습니다.");
        console.log("429 에러 응답 전체:", errText);
        throw new Error('잠시 후 다시 시도해주세요 (API 요청 한도 초과)');
      }
      if (response.status === 503) {
        throw new Error('AI 서버가 현재 혼잡합니다. 잠시 후 다시 시도해주세요 (503).');
      }
      await response.json().catch(() => ({}));
      throw new Error(`임베딩 오류: ${response.statusText}`);
    }
    
    const data = await response.json();
    if (data.embedding && data.embedding.values) {
      return data.embedding.values;
    }
    throw new Error('임베딩 결과를 반환받지 못했습니다.');
  };

  const generateAnswer = async (prompt: string): Promise<string> => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    
    const modelName = "models/gemini-2.5-flash";
    console.log(`[API 호출] 답변 생성 모델: ${modelName}`);
    
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`;
    
    console.log("API 호출 시작");
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    
    if (!response.ok) {
      if (response.status === 429) {
        const errText = await response.text().catch(() => "응답을 읽을 수 없습니다.");
        console.log("429 에러 응답 전체:", errText);
        throw new Error('잠시 후 다시 시도해주세요 (API 요청 한도 초과)');
      }
      if (response.status === 503) {
        throw new Error('AI 서버가 현재 혼잡합니다. 잠시 후 다시 시도해주세요 (503).');
      }
      await response.json().catch(() => ({}));
      throw new Error(`답변 생성 오류: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '답변을 생성할 수 없습니다.';
  };

  const handleSearch = async (searchQuery: string = query) => {
    if (!searchQuery.trim() || isLoading) return;
    
    setIsLoading(true);
    setError('');
    setAnswer('');
    setSources([]);

    try {
      // 1. Get embedding for the query
      const queryEmbedding = await getQueryEmbedding(searchQuery);

      // 2. Search Supabase for similar chunks
      const { data: chunks, error: rpcError } = await supabase.rpc('match_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: 0.5,
        match_count: 5
      });

      if (rpcError) {
        throw new Error(`Supabase 검색 오류: ${rpcError.message}`);
      }

      if (!chunks || chunks.length === 0) {
        setAnswer('관련된 문서를 찾을 수 없습니다.');
        setIsLoading(false);
        return;
      }

      // Extract unique sources and format context
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

      // API 호출 제한(429) 방지를 위한 2초 딜레이
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 3. Generate answer using Gemini 2.0 Flash
      const contextString = contextTexts.join('\n\n---\n\n');
      const prompt = `당신은 회사 업무 전문가입니다. 아래 문서를 참고해서 질문에 답변해주세요.\n\n[문서 내용]\n${contextString}\n\n[질문]\n${searchQuery}\n\n답변:`;
      
      const generatedText = await generateAnswer(prompt);
      setAnswer(generatedText);

    } catch (err: any) {
      console.error(err);
      setError(err.message || '검색 중 오류가 발생했습니다.');
      toast('잠시 후 다시 시도해주세요', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#F8F9FA] relative">
      <div className="flex-1 overflow-y-auto p-8 pb-32">
        <div className="max-w-3xl mx-auto space-y-8">
          
          {/* Header */}
          <div className="text-center mt-8 mb-12 p-10 bg-gradient-to-br from-blue-50 via-purple-50 to-transparent rounded-3xl border border-white shadow-sm">
            <div className="inline-flex items-center justify-center p-4 bg-white rounded-2xl mb-6 shadow-sm">
              <Sparkles className="w-12 h-12 text-blue-600" />
            </div>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">무엇이든 물어보세요</h1>
            <p className="text-gray-500 mt-4 text-lg">회사 업무, 규정, 절차 등 궁금한 점을 AI가 문서 기반으로 답변해 드립니다.</p>
          </div>

          {/* Error Message */}
          {error && <ErrorCard message={error} onRetry={() => handleSearch()} />}

          {/* AI Answer Card */}
          {!isLoading && answer && answer !== '관련된 문서를 찾을 수 없습니다.' && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition-all duration-300">
              <div className="bg-blue-50/50 border-b border-gray-100 p-4 flex items-center">
                <Sparkles className="w-5 h-5 text-blue-600 mr-2" />
                <h2 className="font-semibold text-gray-900">AI 답변</h2>
              </div>
              <div className="p-6">
                <div className="prose prose-blue max-w-none text-gray-800 leading-relaxed prose-headings:font-bold prose-headings:text-gray-900 prose-h1:text-3xl prose-h1:border-b prose-h1:border-gray-200 prose-h1:pb-2 prose-h1:mb-5 prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-6 prose-h3:mb-3 prose-p:my-3 prose-ul:list-disc prose-ul:pl-6 prose-ul:my-3 prose-li:my-1.5 prose-strong:font-bold prose-strong:text-gray-900 prose-blockquote:border-l-4 prose-blockquote:border-blue-300 prose-blockquote:bg-blue-50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={{
                      input: ({node, checked, disabled, ...props}) => {
                        if (props.type === 'checkbox') {
                          return <input type="checkbox" defaultChecked={checked} className="form-checkbox h-4 w-4 text-blue-600 rounded border-gray-300 cursor-pointer inline-block align-middle mr-2" {...props} />;
                        }
                        return <input checked={checked} disabled={disabled} {...props} />;
                      }
                    }}
                  >
                    {answer}
                  </ReactMarkdown>
                </div>
              </div>
              
              {sources.length > 0 && (
                <div className="bg-gray-50 p-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">참고한 문서</p>
                  <div className="flex flex-wrap gap-2">
                    {sources.map((source, idx) => (
                      <div key={idx} className="inline-flex items-center bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:border-blue-300 hover:shadow transition-colors">
                        <FileText className="w-4 h-4 text-blue-500 mr-2" />
                        {source.document_name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!isLoading && answer === '관련된 문서를 찾을 수 없습니다.' && (
            <EmptyState 
              icon={FileText} 
              title="관련 문서를 찾지 못했어요." 
              description="문서를 먼저 업로드해주세요." 
            />
          )}
        </div>
      </div>

      {/* Input Area (Sticky at bottom) */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#F8F9FA] via-[#F8F9FA] to-transparent pt-10 pb-8 px-8">
        <div className="max-w-3xl mx-auto">
          
          {/* Quick Chips */}
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            {quickChips.map((chip, idx) => (
              <button
                key={idx}
                onClick={() => handleChipClick(chip)}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-full shadow-md transition-all duration-200"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
            </div>
            <input
              type="text"
              className="block w-full pl-11 pr-14 py-4 bg-white border-2 border-gray-200 rounded-2xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 focus:border-blue-500 shadow-sm transition-all duration-200 text-lg"
              placeholder="업무와 관련된 질문을 입력하세요..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={isLoading}
            />
            <button
              onClick={() => handleSearch()}
              disabled={isLoading || !query.trim()}
              className="absolute inset-y-2 right-2 flex items-center justify-center w-12 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl transition-colors duration-200"
            >
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 ml-1" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchPage;
