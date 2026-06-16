function out=breakstring(str,n);
% $$$ n: length of chunks into which to break strm if n<0, tries to break
% $$$ on whitespace
  ii=0;
  hit=regexp(str,'\');
  str(hit)='/';
  while 1,
    ii=ii+1;
    m=length(str);
    if m<=abs(n),
      hit=m;
    elseif n<0
      miss=regexp(str,'[\W _]');
      hit=find(miss<abs(n));
      hit=miss(hit(end));
    else
      hit=n;
    end
    out{ii,1}=str(1:hit);
    str=str(hit+1:end);
    if length(str)<1, break; end
  end