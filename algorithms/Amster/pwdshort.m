function out=pwdshort(n,in)
%in: input str of pwd
%n: >0: number of levels to keep
%out: n levels of in
  if nargin<1, n=1; end
  if nargin<2, in=pwd; end
  
  in=regexprep(in,'\','/');
  M=regexp(in,'/');
  if isempty(M),
      M=1;
  end
  m=length(M);
  if n>m,
    n=m;
  end
  out=in(M(1+m-n):end);
  
  
  