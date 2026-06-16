function out=rms(in,dim)
  n=size(in);
  if nargin<2,
    dim=[];
    for ii=1:length(n), %for all dimensions
      if n(ii)>1,
	dim=ii;
      end
    end
    if isempty(dim),
      dim=1;
    end
  end
  out=sqrt(sum(in.^2,dim,'omitnan')/n(dim));