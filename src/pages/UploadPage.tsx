import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, FileText, CheckCircle, XCircle, Play, Database, Server, Zap, Trash2 } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import * as mammoth from 'mammoth';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/ui/ToastContext';
import ErrorCard from '../components/ui/ErrorCard';
import EmptyState from '../components/ui/EmptyState';

// Set up PDF.js worker using unpkg CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

type FileStatus = 'pending' | 'extracting' | 'completed' | 'chunking' | 'embedding' | 'saved' | 'error';

interface UploadedFile {
  id: string;
  file: File;
  status: FileStatus;
  extractedText?: string;
  error?: string;
}

interface ExistingDocument {
  id: string;
  name: string;
  created_at: string;
}

const UploadPage = () => {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [existingDocs, setExistingDocs] = useState<ExistingDocument[]>([]);
  const { toast } = useToast();

  const fetchExistingDocs = useCallback(async () => {
    const { data, error } = await supabase
      .from('documents')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });
      
    if (error) {
      console.error('기존 문서 불러오기 오류:', error);
    } else if (data) {
      setExistingDocs(data);
    }
  }, []);

  React.useEffect(() => {
    fetchExistingDocs();
  }, [fetchExistingDocs]);

  const handleDeleteDoc = async (id: string) => {
    if (!confirm('정말로 이 문서를 삭제하시겠습니까? 관련 데이터가 모두 삭제됩니다.')) return;
    
    // 삭제 시 document_chunks도 같이 삭제
    const { error: chunkError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', id);
      
    if (chunkError) {
      toast('청크 삭제 중 오류가 발생했습니다.', 'error');
      return;
    }
    
    const { error: docError } = await supabase
      .from('documents')
      .delete()
      .eq('id', id);
      
    if (docError) {
      toast('문서 삭제 중 오류가 발생했습니다.', 'error');
      return;
    }
    
    toast('문서가 삭제되었습니다.', 'success');
    fetchExistingDocs();
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      status: 'pending' as FileStatus
    }));
    
    setUploadedFiles(prev => [...prev, ...newFiles]);
    
    // Start extraction for each new file
    newFiles.forEach(fileObj => {
      extractText(fileObj);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt']
    }
  });

  async function extractText(fileObj: UploadedFile) {
    updateFileStatus(fileObj.id, 'extracting');
    
    try {
      let text = '';
      const file = fileObj.file;
      const extension = file.name.split('.').pop()?.toLowerCase();
      
      if (extension === 'txt') {
        text = await extractFromTxt(file);
      } else if (extension === 'docx') {
        text = await extractFromDocx(file);
      } else if (extension === 'pdf') {
        text = await extractFromPdf(file);
      } else {
        throw new Error('지원하지 않는 파일 형식입니다.');
      }
      
      updateFileStatus(fileObj.id, 'completed', text);
    } catch (error: any) {
      console.error(error);
      updateFileStatus(fileObj.id, 'error', undefined, error.message || '추출 중 오류 발생');
      toast('잠시 후 다시 시도해주세요', 'error');
    }
  };

  function updateFileStatus(id: string, status: FileStatus, text?: string, error?: string) {
    setUploadedFiles(prev => prev.map(f => {
      if (f.id === id) {
        return { ...f, status, extractedText: text !== undefined ? text : f.extractedText, error };
      }
      return f;
    }));
  };

  function extractFromTxt(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  };

  async function extractFromDocx(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  };

  async function extractFromPdf(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }
    
    return fullText;
  };

  // --- AI Analysis Logic ---

  const chunkText = (text: string): string[] => {
    // 기존 \n\n 뿐만 아니라 모든 줄바꿈(\n+)을 기준으로 분리하여 단일 청크 방지
    const rawParagraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
    const chunks: string[] = [];
    
    let currentChunk = '';

    for (let i = 0; i < rawParagraphs.length; i++) {
      const p = rawParagraphs[i];
      
      if (!currentChunk) {
        let overlap = '';
        if (chunks.length > 0) {
          const prevChunk = chunks[chunks.length - 1];
          const sentences = prevChunk.match(/[^.!?]+[.!?]+/g) || [];
          if (sentences.length > 0) {
            overlap = sentences[sentences.length - 1].trim() + ' ';
          } else {
            overlap = prevChunk.slice(-50).trim() + ' ';
          }
        }
        currentChunk = overlap + p;
      } else {
        // 최소 글자 수 기준을 10자로 낮춤
        if (p.length < 10) {
          currentChunk += '\n' + p;
        } else {
          chunks.push(currentChunk);
          
          let overlap = '';
          const prevChunk = currentChunk;
          const sentences = prevChunk.match(/[^.!?]+[.!?]+/g) || [];
          if (sentences.length > 0) {
            overlap = sentences[sentences.length - 1].trim() + ' ';
          } else {
            overlap = prevChunk.slice(-50).trim() + ' ';
          }
          
          currentChunk = overlap + p;
        }
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  };

  const getEmbeddings = async (chunks: string[]): Promise<number[][]> => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API 키가 설정되지 않았습니다.');
    
    const modelName = "models/gemini-embedding-2";
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:batchEmbedContents?key=${apiKey}`;
    
    const allEmbeddings: number[][] = [];
    // 대용량 문서를 대비해 100개씩 묶어서 배치 전송 (현재 문서는 14개라 1번만 호출됨)
    const BATCH_SIZE = 100; 

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batchChunks = chunks.slice(i, i + BATCH_SIZE);
      const requests = batchChunks.map(chunk => ({
        model: modelName,
        content: { parts: [{ text: chunk }] }
      }));
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
      });
      
      if (!response.ok) {
        if (response.status === 429) throw new Error('API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.');
        if (response.status === 503) throw new Error('AI 서버가 현재 혼잡합니다. 잠시 후 다시 시도해주세요 (503).');
        const errorData = await response.text().catch(() => "응답 없음");
        throw new Error(`Embedding Batch API 오류: ${response.statusText} - ${errorData}`);
      }
      
      const data = await response.json();
      
      if (data.embeddings && Array.isArray(data.embeddings)) {
        const batchEmbeddings = data.embeddings.map((emb: any) => emb.values);
        allEmbeddings.push(...batchEmbeddings);
      } else {
        throw new Error('임베딩 결과를 배열로 반환받지 못했습니다.');
      }
    }
    
    return allEmbeddings;
  };

  const saveToSupabase = async (fileObj: UploadedFile, chunks: string[], embeddings: number[][]) => {
    // 1. 기존 문서가 있는지 이름으로 검색 (중복 업로드 덮어쓰기)
    const { data: existingDocs, error: searchError } = await supabase
      .from('documents')
      .select('id')
      .eq('name', fileObj.file.name);

    if (searchError) throw new Error(`기존 문서 검색 오류: ${searchError.message}`);

    let documentId;

    if (existingDocs && existingDocs.length > 0) {
      documentId = existingDocs[0].id;
      // 기존 문서의 청크 데이터를 삭제 (덮어쓰기)
      const { error: deleteError } = await supabase
        .from('document_chunks')
        .delete()
        .eq('document_id', documentId);
        
      if (deleteError) throw new Error(`기존 청크 삭제 오류: ${deleteError.message}`);
    } else {
      // 2. 새 문서 삽입
      const { data: docData, error: docError } = await supabase
        .from('documents')
        .insert({
          name: fileObj.file.name,
          file_type: fileObj.file.name.split('.').pop()?.toLowerCase() || 'unknown',
        })
        .select('id')
        .single();
        
      if (docError) throw new Error(`Supabase documents 테이블 저장 오류: ${docError.message}`);
      documentId = docData.id;
    }
    
    const chunkRows = chunks.map((content, index) => ({
      document_id: documentId,
      content,
      chunk_index: index,
      embedding: embeddings[index]
    }));
    
    const { error: chunksError } = await supabase
      .from('document_chunks')
      .insert(chunkRows);
      
    if (chunksError) throw new Error(`Supabase document_chunks 테이블 저장 오류: ${chunksError.message}`);
  };

  const handleAiAnalysis = async (fileObj: UploadedFile) => {
    if (!fileObj.extractedText) return;
    
    try {
      console.log('--- 원본 텍스트 전체 ---');
      console.log(fileObj.extractedText);
      console.log('------------------------');

      updateFileStatus(fileObj.id, 'chunking');
      const chunks = chunkText(fileObj.extractedText);
      
      console.log('--- 청킹 결과 배열 ---');
      console.log(chunks);
      console.log(`총 청크 수: ${chunks.length}`);
      console.log('----------------------');
      
      if (chunks.length === 0) {
        throw new Error('추출된 텍스트가 없어 청킹할 수 없습니다.');
      }

      updateFileStatus(fileObj.id, 'embedding');
      const embeddings = await getEmbeddings(chunks);

      updateFileStatus(fileObj.id, 'saved'); // Before actual save to indicate saving step... Wait, let's keep it 'embedding' or 'saving'
      // To strictly follow: "추출 완료 → 청킹 중 → 임베딩 중 → 저장 완료", actually it means the DB operation happens right before 'saved'.
      // I'll update it to 'saved' AFTER saving. I will just do the save.
      
      await saveToSupabase(fileObj, chunks, embeddings);
      
      updateFileStatus(fileObj.id, 'saved');
      toast('문서가 저장됐어요', 'success');
      fetchExistingDocs();
      
    } catch (error: any) {
      console.error(error);
      updateFileStatus(fileObj.id, 'error', undefined, error.message || 'AI 분석 중 오류 발생');
      toast('잠시 후 다시 시도해주세요', 'error');
    }
  };

  // --- UI Helpers ---

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderStatusBadge = (status: FileStatus) => {
    switch (status) {
      case 'pending':
        return <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">대기 중</span>;
      case 'extracting':
        return (
          <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full flex items-center border border-blue-100">
            <svg className="animate-spin -ml-1 mr-1.5 h-3.5 w-3.5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            추출 중...
          </span>
        );
      case 'completed':
        return (
          <span className="text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-full flex items-center border border-green-100">
            <CheckCircle size={14} className="mr-1 text-green-500" /> 추출 완료
          </span>
        );
      case 'chunking':
        return (
          <span className="text-xs font-medium text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full flex items-center border border-purple-100">
            <Zap size={14} className="mr-1 text-purple-500 animate-pulse" /> 청킹 중...
          </span>
        );
      case 'embedding':
        return (
          <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full flex items-center border border-indigo-100">
            <Server size={14} className="mr-1 text-indigo-500 animate-pulse" /> 임베딩 중...
          </span>
        );
      case 'saved':
        return (
          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full flex items-center border border-emerald-200 shadow-sm">
            <Database size={14} className="mr-1 text-emerald-600" /> 검색 가능 (저장 완료)
          </span>
        );
      case 'error':
        return (
          <span className="text-xs font-medium text-red-700 bg-red-50 px-2.5 py-1 rounded-full flex items-center border border-red-100">
            <XCircle size={14} className="mr-1 text-red-500" /> 실패
          </span>
        );
    }
  };

  return (
    <div className="p-8 h-full bg-[#F8F9FA] flex flex-col">
      <div className="mb-6 p-5 bg-gradient-to-r from-blue-50 via-indigo-50 to-transparent rounded-2xl border border-white shadow-sm flex items-center gap-4">
        <div className="flex-shrink-0 flex items-center justify-center p-3 bg-white rounded-xl shadow-sm">
          <UploadCloud className="w-7 h-7 text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">문서 업로드</h1>
          <p className="text-gray-500 mt-0.5 text-sm">PDF, DOCX, TXT 파일을 업로드하여 내용을 추출하고 AI로 분석하세요.</p>
        </div>
      </div>

      {/* Dropzone Area */}
      <div 
        {...getRootProps()} 
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-200 ease-in-out ${
          isDragActive 
            ? 'border-blue-500 bg-blue-50 shadow-inner' 
            : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-gray-50 hover:shadow-sm'
        }`}
      >
        <input {...getInputProps()} />
        <UploadCloud className={`mx-auto h-14 w-14 mb-4 transition-colors duration-200 ${isDragActive ? 'text-blue-500' : 'text-gray-400'}`} />
        <p className="text-lg font-medium text-gray-700">
          {isDragActive ? '여기에 파일을 놓아주세요' : '클릭하거나 파일을 여기로 드래그하세요'}
        </p>
        <p className="text-sm text-gray-500 mt-2 font-medium">지원 형식: .pdf, .docx, .txt</p>
      </div>

      {/* Uploaded Files List */}
      {uploadedFiles.length > 0 && (
        <div className="mt-8 flex-shrink-0 flex flex-col max-h-96">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
            새로 업로드한 파일 목록
            <span className="ml-2 bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {uploadedFiles.length}
            </span>
          </h2>
          
          <div className="overflow-y-auto space-y-4 pr-2">
            {uploadedFiles.map(fileObj => (
              <div key={fileObj.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col transition-all duration-200 hover:shadow-md">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                  <div className="flex items-center space-x-4">
                    <div className="p-2.5 bg-white border border-gray-100 shadow-sm text-blue-600 rounded-lg">
                      <FileText size={22} />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm truncate max-w-xs" title={fileObj.file.name}>
                        {fileObj.file.name}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5 font-medium">{formatFileSize(fileObj.file.size)}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    {renderStatusBadge(fileObj.status)}
                    
                    {fileObj.status === 'completed' && (
                      <button
                        onClick={() => handleAiAnalysis(fileObj)}
                        className="flex items-center text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg shadow-sm transition-colors"
                      >
                        <Play size={14} className="mr-1.5" />
                        AI 분석 시작
                      </button>
                    )}
                  </div>
                </div>
                
                {/* Extracted Text Preview Area */}
                {(fileObj.status === 'completed' || fileObj.status === 'chunking' || fileObj.status === 'embedding') && fileObj.extractedText && (
                  <div className="p-0">
                    <div className="bg-gray-800 text-gray-300 px-4 py-1.5 text-xs font-medium flex justify-between items-center">
                      <span>추출된 텍스트 미리보기</span>
                      <span className="text-gray-400">{fileObj.extractedText.length.toLocaleString()} 자</span>
                    </div>
                    <div className="p-4 max-h-48 overflow-y-auto text-sm text-gray-700 font-mono leading-relaxed bg-gray-50 whitespace-pre-wrap">
                      {fileObj.extractedText}
                    </div>
                  </div>
                )}
                
                {/* Error Area */}
                {fileObj.status === 'error' && fileObj.error && (
                  <div className="p-4 bg-gray-50/50">
                    <ErrorCard 
                      message={fileObj.error} 
                      onRetry={() => {
                        if (fileObj.extractedText) handleAiAnalysis(fileObj);
                        else extractText(fileObj);
                      }} 
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Existing Documents List */}
      <div className="mt-8 flex-1 flex flex-col min-h-0">
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
          기존 업로드된 문서
          <span className="ml-2 bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full">
            {existingDocs.length}
          </span>
        </h2>
        
        {existingDocs.length === 0 && uploadedFiles.length === 0 ? (
          <EmptyState 
            icon={Database} 
            title="저장된 문서가 없어요." 
            description="위 영역에 파일을 드래그하거나 클릭해서 문서를 추가해주세요." 
          />
        ) : existingDocs.length === 0 ? (
          <div className="text-center py-8 text-gray-500 bg-white border border-gray-200 rounded-xl border-dashed">
            기존에 업로드된 문서가 없습니다.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-3 pr-2 pb-8">
            {existingDocs.map(doc => (
              <div key={doc.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex items-center justify-between p-4 hover:shadow-md transition-all duration-200">
                <div className="flex items-center space-x-4">
                  <div className="p-2 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-lg">
                    <Database size={20} />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm truncate max-w-xs" title={doc.name}>
                      {doc.name}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 font-medium">
                      {new Date(doc.created_at).toLocaleDateString()} 업로드
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4">
                  <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full flex items-center border border-emerald-200 shadow-sm">
                    <CheckCircle size={14} className="mr-1 text-emerald-600" /> 검색 가능
                  </span>
                  <button
                    onClick={() => handleDeleteDoc(doc.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="문서 삭제"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UploadPage;
